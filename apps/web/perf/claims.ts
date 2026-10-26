import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import puppeteer, { type Page } from 'puppeteer-core';

const PORT = Number(process.env.PERF_PORT ?? 3116);
const BASE = `http://127.0.0.1:${String(PORT)}`;
const SAMPLE = `${BASE}/sessions/session-canvas`;
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
  console.error('claims-check: no Chrome found; set CHROME_PATH');
  process.exit(2);
}

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

// Counts WebGL contexts the page asks for; a string so the hook runs before any page script.
const COUNT_WEBGL = `(() => {
  const get = HTMLCanvasElement.prototype.getContext;
  window.__webglContexts = 0;
  HTMLCanvasElement.prototype.getContext = function (type, ...rest) {
    if (String(type).startsWith('webgl')) window.__webglContexts += 1;
    return get.call(this, type, ...rest);
  };
})()`;

declare global {
  interface Window {
    __webglContexts?: number;
  }
}

async function ready(): Promise<void> {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
      if ((await fetch(SAMPLE)).ok) return;
    } catch {
      /* not up yet */
    }
    await wait(500);
  }
  throw new Error('web did not start');
}

interface Probe {
  headline: string;
  states: string[];
  arcs: number;
  verdicts: number;
  sample: boolean;
  webgl: number;
  running: number;
  pulses: string[];
  arcOffsets: string[];
  dashed: string[];
  fractures: string[];
  overflow: boolean;
  links: number;
  buttons: { disabled: boolean; reason: string }[];
}

async function probe(page: Page, width: number, reduced: boolean): Promise<Probe> {
  await page.setViewport({ width, height: 900, deviceScaleFactor: 1 });
  await page.emulateMediaFeatures([
    { name: 'prefers-reduced-motion', value: reduced ? 'reduce' : 'no-preference' },
  ]);
  await page.goto(SAMPLE, { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);
  await wait(300);
  return page.evaluate(() => {
    const main = document.querySelector('main');
    return {
      headline: document.querySelector('h1')?.textContent ?? '',
      states: [...document.querySelectorAll('li[data-state]')]
        .filter((row) => row.closest('section[aria-labelledby="claims-heading"]') !== null)
        .map((row) => row.getAttribute('data-state') ?? ''),
      arcs: document.querySelectorAll('.ring-arc, .ring-arc-dashed').length,
      verdicts: document.querySelectorAll('[data-testid="verdict"]').length,
      sample: document.querySelector('[data-testid="sample"]') !== null,
      webgl: window.__webglContexts ?? -1,
      running: document.getAnimations().filter((animation) => animation.playState === 'running')
        .length,
      pulses: [...document.querySelectorAll('.beam-run')].map(
        (node) => getComputedStyle(node).opacity,
      ),
      arcOffsets: [...document.querySelectorAll('.ring-arc')].map(
        (node) => getComputedStyle(node).strokeDashoffset,
      ),
      dashed: [...document.querySelectorAll('.ring-arc-dashed')].map(
        (node) => getComputedStyle(node).opacity,
      ),
      fractures: [...document.querySelectorAll('.beam-fracture')].map(
        (node) => getComputedStyle(node).opacity,
      ),
      overflow: document.documentElement.scrollWidth > window.innerWidth,
      links: main?.querySelectorAll('a').length ?? -1,
      buttons: [...(main?.querySelectorAll('button') ?? [])].map((button) => ({
        disabled: button.disabled,
        reason:
          document.getElementById(button.getAttribute('aria-describedby') ?? '')?.textContent ?? '',
      })),
    };
  });
}

const server = spawn('pnpm', ['exec', 'next', 'start', '--port', String(PORT)], {
  stdio: ['ignore', 'inherit', 'inherit'],
  env: { ...process.env, DEBRIEF_API_KEY: process.env.DEBRIEF_API_KEY ?? 'claims' },
});
const failures: string[] = [];
const fail = (message: string): void => {
  console.error(`claims-check: ${message}`);
  failures.push(message);
};
try {
  await ready();
  const missing = await fetch(`${BASE}/sessions/session-other`);
  const browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: true,
    args: ['--no-sandbox'],
  });
  try {
    const page = await browser.newPage();
    await page.evaluateOnNewDocument(COUNT_WEBGL);
    const moving = await probe(page, 1440, false);
    const still = await probe(page, 1440, true);
    const phone = await probe(page, 390, false);
    const phoneStill = await probe(page, 390, true);
    console.log(
      `claims: "${moving.headline}", ${String(moving.states.length)} rows (${moving.states.join(' ')}), ${String(moving.arcs)} arcs, ${String(moving.verdicts)} verdicts, sample ${String(moving.sample)}, ${String(moving.webgl)} webgl contexts, ${String(moving.running)} animations running; reduced motion: ${String(still.running)} running, pulses at opacity ${[...new Set(still.pulses)].join('/')} (${String(still.pulses.length)}), arcs at offset ${[...new Set(still.arcOffsets)].join('/')} (${String(still.arcOffsets.length)}), dashed at ${[...new Set(still.dashed)].join('/')}, fractures at ${[...new Set(still.fractures)].join('/')} (${String(still.fractures.length)}); 390: ${String(phone.running)} running, overflow ${String(phone.overflow || phoneStill.overflow)}, ${String(phoneStill.running)} running reduced; unknown session ${String(missing.status)}`,
    );
    if (moving.headline !== 'Seven claims.Two fall apart.') fail('the headline is wrong');
    if (
      moving.states.join(' ') !== 'contradicted contradicted holds holds holds holds no-witness'
    ) {
      fail('the claims are not the canvas seven in verdict order');
    }
    if (moving.arcs !== 7 || moving.verdicts !== 7 || !moving.sample) {
      fail('ring, verdicts or the sample mark are missing');
    }
    if (moving.webgl !== 0) fail('the claim check created a WebGL context');
    if (moving.running === 0 || phone.running === 0) fail('nothing moves without reduced motion');
    for (const frame of [still, phoneStill]) {
      const whole =
        frame.running === 0 &&
        frame.pulses.length === 4 &&
        frame.pulses.every((opacity) => opacity === '0') &&
        frame.arcOffsets.length === 6 &&
        frame.arcOffsets.every((offset) => /^0(px)?$/.test(offset)) &&
        frame.dashed.every((opacity) => opacity === '0.8') &&
        frame.fractures.length === 2 &&
        frame.fractures.every((opacity) => opacity === '1');
      if (!whole) {
        fail('an animation runs under prefers-reduced-motion, or its still frame hides something');
      }
    }
    if ([moving, phone, phoneStill].some((frame) => frame.overflow)) {
      fail('the page scrolls sideways');
    }
    if (moving.links !== 0) fail('the page links somewhere that does not exist yet');
    if (moving.buttons.some((button) => !button.disabled || button.reason === '')) {
      fail('a button for an unbuilt route is enabled or does not say why');
    }
    if (missing.status !== 404) fail('an unknown session does not answer 404');
  } finally {
    await browser.close();
  }
} finally {
  server.kill('SIGTERM');
}
process.exit(failures.length === 0 ? 0 : 1);
