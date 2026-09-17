import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import puppeteer, { type Browser, type Page } from 'puppeteer-core';

import type { TheatreHandle } from '../src/scenes/theatre-probe';

const PORT = Number(process.env.PERF_PORT ?? 3112);
const BASE = `http://127.0.0.1:${String(PORT)}`;
const OUT = new URL('./out/', import.meta.url).pathname;
const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium-browser',
  '/usr/bin/chromium',
].filter((candidate): candidate is string => candidate !== undefined);
const SHOTS = ['establishing', 'follow', 'freeze', 'ripple', 'pull-back'] as const;

const chromePath = CHROME_CANDIDATES.find((candidate) => existsSync(candidate));
if (chromePath === undefined) {
  console.error('camera-check: no Chrome found; set CHROME_PATH');
  process.exit(2);
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

interface Shot {
  label: string;
  t: number;
  png: Uint8Array;
  page: Uint8Array;
  pose: TheatreHandle['pose'];
  overlap: boolean;
  subtitle: string;
}

interface Rect {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

const intersects = (a: Rect, b: Rect): boolean =>
  a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;

// A seek schedules a frame from the clock subscription and another after React commits; wait until no pose frame has run for 300 ms.
async function settle(page: Page): Promise<void> {
  let last = -1;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    await wait(300);
    const frames = await page.evaluate(() => window.__theatre?.frames ?? 0);
    if (frames === last) return;
    last = frames;
  }
  throw new Error('frames never settled');
}

// Play from t=0, pause at each of five keyframes (seeking exactly onto them), screenshot and read the pose.
async function playback(page: Page, pass: number): Promise<Shot[]> {
  const handle = await page.evaluate(() => window.__theatre);
  if (handle === undefined) throw new Error('theatre handle missing');
  const picks = SHOTS.map((label) =>
    handle.keyframes.find((frame) => frame.label === label),
  ).filter((frame): frame is NonNullable<typeof frame> => frame !== undefined);
  const shots: Shot[] = [];
  await page.evaluate(() => {
    const slider = document.querySelector<HTMLElement>('[role="slider"]');
    slider?.focus();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }));
  });
  for (const frame of picks) {
    await page.evaluate(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
    });
    await page.waitForFunction(
      (target: number) => {
        const slider = document.querySelector('[role="slider"]');
        return Number(slider?.getAttribute('aria-valuenow') ?? -1) >= target;
      },
      { timeout: 30_000 },
      Math.round(frame.t * 1000),
    );
    await page.evaluate(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
    });
    await page.evaluate((target: number) => {
      window.__theatreSeek?.(target);
    }, frame.t * 1000);
    await settle(page);
    const pose = await page.evaluate(() => window.__theatre?.pose);
    // No inner named functions: tsx would inject a `__name` helper that does not exist in the page.
    const rects = await page.evaluate(() => {
      const subtitleRect = document
        .querySelector('[data-testid="subtitle-overlay"]')
        ?.getBoundingClientRect();
      const scrubberRect = document.querySelector('[role="slider"]')?.getBoundingClientRect();
      return {
        subtitle:
          subtitleRect === undefined
            ? undefined
            : {
                top: subtitleRect.top,
                bottom: subtitleRect.bottom,
                left: subtitleRect.left,
                right: subtitleRect.right,
              },
        scrubber:
          scrubberRect === undefined
            ? undefined
            : {
                top: scrubberRect.top,
                bottom: scrubberRect.bottom,
                left: scrubberRect.left,
                right: scrubberRect.right,
              },
        text: document.querySelector('[data-testid="subtitle-overlay"]')?.textContent ?? '',
      };
    });
    if (rects.subtitle === undefined || rects.scrubber === undefined)
      throw new Error('subtitle or scrubber missing');
    const stage = await page.$('[data-testid="graph-view"] canvas');
    if (stage === null) throw new Error('stage canvas missing');
    const png = await stage.screenshot({ type: 'png' });
    // The side column keeps its scroll offset between passes; the page shot is about layout, not scrolling.
    await page.evaluate(() => {
      for (const column of document.querySelectorAll('.overflow-y-auto')) column.scrollTop = 0;
    });
    const full = await page.screenshot({ type: 'png' });
    shots.push({
      label: frame.label,
      t: frame.t,
      png,
      page: full,
      pose,
      overlap: intersects(rects.subtitle, rects.scrubber),
      subtitle: rects.text,
    });
    mkdirSync(OUT, { recursive: true });
    writeFileSync(`${OUT}${String(pass)}-${frame.label}.png`, png);
    writeFileSync(`${OUT}${String(pass)}-${frame.label}-page.png`, full);
  }
  return shots;
}

const server = spawn('pnpm', ['exec', 'next', 'start', '--port', String(PORT)], {
  stdio: ['ignore', 'inherit', 'inherit'],
  env: { ...process.env, DEBRIEF_API_KEY: process.env.DEBRIEF_API_KEY ?? 'perf' },
});
let failed = false;
try {
  await ready();
  const browser: Browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-gpu',
      '--use-gl=angle',
      '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader',
      '--ignore-gpu-blocklist',
    ],
  });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 960, height: 720, deviceScaleFactor: 1 });
    const blobRequests: string[] = [];
    page.on('request', (request) => {
      if (request.url().includes('/api/blob')) blobRequests.push(request.url());
    });
    await page.goto(`${BASE}/perf/theatre`, { waitUntil: 'networkidle0' });
    // Wall-clock CSS animations (the ember flash) and fading overlay scrollbars are not part of the camera path.
    await page.addStyleTag({
      content:
        '*, *::before, *::after { animation: none !important; transition: none !important; scrollbar-width: none; } ::-webkit-scrollbar { display: none; }',
    });
    await page.waitForFunction(() => window.__theatre !== undefined, { timeout: 30_000 });
    const first = await playback(page, 1);
    const second = await playback(page, 2);
    for (const [index, shot] of first.entries()) {
      const twin = second[index];
      const same =
        twin !== undefined && Buffer.compare(Buffer.from(shot.png), Buffer.from(twin.png)) === 0;
      const samePage =
        twin !== undefined && Buffer.compare(Buffer.from(shot.page), Buffer.from(twin.page)) === 0;
      const pose = shot.pose;
      const poseOk =
        pose !== undefined &&
        twin?.pose !== undefined &&
        JSON.stringify(pose.position) === JSON.stringify(twin.pose.position) &&
        JSON.stringify(pose.target) === JSON.stringify(twin.pose.target);
      console.log(
        `${shot.label} @ ${String(shot.t)}s: stage ${same ? 'identical' : 'DIFFERS'}, page ${samePage ? 'identical' : 'differs'}, pose ${poseOk ? 'identical' : 'DIFFERS'}${pose === undefined ? '' : ` (${pose.position.map((v) => v.toFixed(2)).join(', ')} → ${pose.target.map((v) => v.toFixed(2)).join(', ')})`}`,
      );
      // The page shot is informational: Chrome's compositor jitters a pixel or two at column edges between passes.
      if (!same || !poseOk) failed = true;
    }
    // The deletion event: the panel's backups cell and the stage flare must come from the same clock value.
    const deletionT = await page.evaluate(() => window.__theatre?.deletionT);
    if (deletionT === undefined) throw new Error('deletion time missing');
    await page.evaluate((target: number) => {
      window.__theatreSeek?.(target);
    }, deletionT);
    await settle(page);
    const sameFrame = await page.evaluate(() => {
      const cell = document.querySelector('[data-testid="backups"]');
      return {
        text: cell?.textContent ?? '',
        changed: cell?.getAttribute('data-changed'),
        panelEvent: document
          .querySelector('[data-testid="world-panel"]')
          ?.getAttribute('data-event'),
        flares: window.__theatre?.flares,
      };
    });
    const volumeFlared =
      sameFrame.flares?.ids.includes('resource:orbital:projects/nova/volumes/vol-prod-01') === true;
    const backupsShown =
      sameFrame.text.startsWith('2') &&
      sameFrame.text.endsWith('0') &&
      sameFrame.changed === sameFrame.panelEvent;
    console.log(
      `deletion @ ${deletionT.toFixed(1)}ms: backups "${sameFrame.text}" ${sameFrame.changed === null ? 'unchanged' : 'flashing'}, volume flare ${volumeFlared ? 'on' : 'OFF'} at t=${String(sameFrame.flares?.t)}`,
    );
    if (!volumeFlared || !backupsShown || sameFrame.flares?.t !== deletionT) {
      console.error('camera-check: panel and flare disagree at the deletion event');
      failed = true;
    }
    for (const shot of [...first, ...second]) {
      if (shot.overlap) {
        console.error(`camera-check: subtitles overlap the scrubber at ${shot.label}`);
        failed = true;
      }
      if (shot.subtitle === '') {
        console.error(`camera-check: no subtitle at ${shot.label}`);
        failed = true;
      }
    }
    console.log(
      `subtitles: ${String(first.length + second.length)} keyframes clear of the scrubber; blob requests during playback: ${String(blobRequests.length)}`,
    );
    if (blobRequests.length > 0) {
      console.error('camera-check: blob fetched during playback');
      failed = true;
    }
    if (first.length !== SHOTS.length) {
      console.error(
        `camera-check: expected ${String(SHOTS.length)} keyframes, got ${String(first.length)}`,
      );
      failed = true;
    }
  } finally {
    await browser.close();
  }
} finally {
  server.kill('SIGTERM');
}
process.exit(failed ? 1 : 0);
