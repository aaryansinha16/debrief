import { spawn } from 'node:child_process';
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';

import puppeteer from 'puppeteer-core';

import { renderLanding } from '../src/lib/landing';

const PORT = Number(process.env.PERF_PORT ?? 3114);
const BASE = `http://127.0.0.1:${String(PORT)}`;
const VERIFY = new URL('../../verify/dist/index.html', import.meta.url);
const VIDEO = new URL('../public/demo/theatre.webm', import.meta.url).pathname;
const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium-browser',
  '/usr/bin/chromium',
].filter((candidate): candidate is string => candidate !== undefined);

const chromePath = CHROME_CANDIDATES.find((candidate) => existsSync(candidate));
if (chromePath === undefined) {
  console.error('landing-check: no Chrome found; set CHROME_PATH');
  process.exit(2);
}

// What the verifier publishes for its own check (apps/verify/src/main.ts); typed here so this script stays standalone.
declare global {
  interface Window {
    __verify?: { outcome: string; seq?: number; links: number; lit: number };
  }
}

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

async function ready(): Promise<void> {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
      if ((await fetch(`${BASE}/live`)).ok) return;
    } catch {
      /* not up yet */
    }
    await wait(500);
  }
  throw new Error('web did not start');
}

// Chrome's "Fast 3G" preset: 1.6 Mbps down, 750 kbps up, 150 ms round trip.
const FAST_3G = {
  offline: false,
  downloadThroughput: (1.6 * 1024 * 1024) / 8,
  uploadThroughput: (750 * 1024) / 8,
  latency: 150,
};

let failed = false;
// The landing is rendered at build time (scripts/render-landing.ts); this check points it at the local verifier build.
const LANDING = new URL('../public/index.html', import.meta.url);
const previous = existsSync(LANDING) ? readFileSync(LANDING, 'utf8') : undefined;
writeFileSync(LANDING, renderLanding(VERIFY.href));
const server = spawn('pnpm', ['exec', 'next', 'start', '--port', String(PORT)], {
  stdio: ['ignore', 'inherit', 'inherit'],
  env: {
    ...process.env,
    DEBRIEF_API_KEY: process.env.DEBRIEF_API_KEY ?? 'landing',
    VERIFY_URL: VERIFY.href,
  },
});
try {
  await ready();
  const browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: true,
    args: ['--no-sandbox', '--allow-file-access-from-files'],
  });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 900, deviceScaleFactor: 1 });
    const session = await page.createCDPSession();
    await session.send('Network.enable');
    await session.send('Network.emulateNetworkConditions', FAST_3G);
    // A warm-up fetch takes the server's first-request compile out of the measurement; the browser cache is disabled.
    await page.setCacheEnabled(false);
    await page.goto(`${BASE}/`, { waitUntil: 'load' });
    const loads: number[] = [];
    let transferred = 0;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await page.goto(`${BASE}/`, { waitUntil: 'load' });
      const timing = await page.evaluate(() => {
        const [navigation] = performance.getEntriesByType('navigation');
        const entry = navigation as PerformanceNavigationTiming | undefined;
        const resources = performance.getEntriesByType('resource') as PerformanceResourceTiming[];
        return {
          load: entry === undefined ? Number.NaN : entry.loadEventEnd - entry.startTime,
          bytes: (entry?.transferSize ?? 0) + resources.reduce((sum, r) => sum + r.transferSize, 0),
        };
      });
      loads.push(timing.load);
      transferred = timing.bytes;
    }
    const best = Math.min(...loads);
    const budget = Number(process.env.LANDING_LOAD_MS ?? 1000);
    console.log(
      `landing: load ${loads.map((ms) => ms.toFixed(0)).join('/')} ms on fast 3G (best ${best.toFixed(0)} ms, ${(transferred / 1024).toFixed(0)} kB transferred, budget ${String(budget)} ms)`,
    );
    if (!(best < budget)) {
      console.error(`landing-check: the landing loads slower than ${String(budget)} ms on fast 3G`);
      failed = true;
    }
    const filmPreload = await page.evaluate(
      () => document.querySelector('[data-testid="film"]')?.getAttribute('preload') ?? '',
    );
    const story = await page.evaluate(
      () => document.querySelectorAll('[data-testid="story"] li').length,
    );
    if (filmPreload !== 'none' || story < 5) {
      console.error('landing-check: the film must be lazy and the story complete');
      failed = true;
    }
    await session.send('Network.emulateNetworkConditions', {
      ...FAST_3G,
      offline: false,
      latency: 0,
      downloadThroughput: -1,
      uploadThroughput: -1,
    });
    const size = statSync(VIDEO).size;
    console.log(`video: ${(size / 1024 / 1024).toFixed(2)} MB (budget 8 MB)`);
    if (size > 8 * 1024 * 1024) {
      console.error('landing-check: the video is over 8 MB');
      failed = true;
    }
    const cta = await page.evaluate(
      () => document.querySelector('[data-testid="verify-cta"]')?.getAttribute('href') ?? '',
    );
    const expected = `${VERIFY.href}?bundle=${encodeURIComponent(`${BASE}/demo/bundle.zip`)}`;
    console.log(`cta: ${cta}`);
    if (cta !== expected) {
      console.error(`landing-check: the cta should be ${expected}`);
      failed = true;
    }
    if (!existsSync(VERIFY)) {
      console.error(
        'landing-check: build the verifier first (pnpm --filter @debrief/verify build)',
      );
      failed = true;
    } else {
      const verifier = await browser.newPage();
      await verifier.goto(cta, { waitUntil: 'load' });
      await verifier.waitForFunction(() => window.__verify !== undefined, { timeout: 30_000 });
      const outcome = await verifier.evaluate(() => ({
        outcome: window.__verify?.outcome,
        lit: window.__verify?.lit,
        links: window.__verify?.links,
        verdict: document.querySelector('[data-testid="verdict"]')?.textContent ?? '',
      }));
      console.log(
        `verifier: ${String(outcome.outcome)} · ${String(outcome.lit)}/${String(outcome.links)} links · "${outcome.verdict.slice(0, 60)}"`,
      );
      if (outcome.outcome !== 'verified' || outcome.lit !== outcome.links) {
        console.error('landing-check: the cta did not open a verified demo bundle');
        failed = true;
      }
    }
  } finally {
    await browser.close();
  }
} finally {
  server.kill('SIGTERM');
  if (previous !== undefined) writeFileSync(LANDING, previous);
}
process.exit(failed ? 1 : 0);
