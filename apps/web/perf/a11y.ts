import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import puppeteer, { type KeyInput, type Page } from 'puppeteer-core';

import { type StubApi, fleetBeat, startStubApi } from './stub-api';

const PORT = Number(process.env.PERF_PORT ?? 3117);
const API_PORT = Number(process.env.STUB_API_PORT ?? 3118);
const BASE = `http://127.0.0.1:${String(PORT)}`;
const BEATS = 3;
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
  console.error('a11y-check: no Chrome found; set CHROME_PATH');
  process.exit(2);
}

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

// Counts every animation frame callback the page runs; a string so the hook is in place before any page script.
const COUNT_FRAMES = `(() => {
  const request = window.requestAnimationFrame.bind(window);
  window.__frames = 0;
  window.requestAnimationFrame = (callback) =>
    request((time) => {
      window.__frames += 1;
      callback(time);
    });
})()`;

declare global {
  interface Window {
    __frames?: number;
  }
}

async function ready(): Promise<void> {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
      if ((await fetch(`${BASE}/runs`)).ok) return;
    } catch {
      /* not up yet */
    }
    await wait(500);
  }
  throw new Error('web did not start');
}

const framesSince = (page: Page): Promise<number> =>
  page.evaluate(() => {
    const frames = window.__frames ?? -1;
    window.__frames = 0;
    return frames;
  });

const runningAnimations = (page: Page): Promise<number> =>
  page.evaluate(
    () => document.getAnimations().filter((animation) => animation.playState === 'running').length,
  );

interface LiveMotion {
  motion: string;
  drawn: number;
  idle: number;
  running: number;
  labels: number;
  received: number;
}

// Each beat of the feed draws its frame; once it has, the page must sit still until the next beat.
async function liveMotion(page: Page, stub: StubApi, reduced: boolean): Promise<LiveMotion> {
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
  await page.emulateMediaFeatures([
    { name: 'prefers-reduced-motion', value: reduced ? 'reduce' : 'no-preference' },
  ]);
  await page.goto(`${BASE}/live`, { waitUntil: 'load' });
  await page.waitForSelector('[data-testid="approach-view"][data-connection="live"]');
  await wait(1500);
  let drawn = 0;
  let idle = 0;
  let running = await runningAnimations(page);
  for (let beat = 1; beat <= BEATS; beat += 1) {
    await framesSince(page);
    stub.emit(fleetBeat(beat));
    // Polled on a timer: puppeteer's default polls on requestAnimationFrame, which the count would see.
    await page.waitForFunction(() => (window.__frames ?? 0) > 0, { polling: 50, timeout: 10_000 });
    await wait(250);
    drawn += await framesSince(page);
    await wait(1200);
    idle += await framesSince(page);
    running = Math.max(running, await runningAnimations(page));
  }
  return page.evaluate(
    (summary) => {
      const stats = document.querySelector('[data-testid="approach-stats"]')?.textContent ?? '';
      return {
        ...summary,
        motion:
          document.querySelector('[data-testid="approach-view"]')?.getAttribute('data-motion') ??
          '',
        labels: document.querySelectorAll('[data-testid="zone-label"]').length,
        received: Number(/(\d+) received/.exec(stats)?.[1] ?? -1),
      };
    },
    { drawn, idle, running },
  );
}

interface TranscriptScroll {
  moved: number[];
  hidden: number;
  seeks: number;
}

// The transcript follows the clock by scrolling its own list: the window stays where the reader left it.
async function transcriptScroll(page: Page, stub: StubApi): Promise<TranscriptScroll> {
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1 });
  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'no-preference' }]);
  await page.goto(`${BASE}/runs/${stub.runId}?event=${stub.freezeEventId}`, { waitUntil: 'load' });
  await page.waitForSelector('[data-testid="narrative-row"][data-current="true"]');
  await wait(800);
  const moved: number[] = [];
  let hidden = 0;
  const look = async (expected: number): Promise<void> => {
    const seen = await page.evaluate(() => {
      const list = document.querySelector('[data-testid="narrative"] ol');
      const row = list?.querySelector('[data-current="true"]');
      if (list === null || row === null || row === undefined) {
        return { y: window.scrollY, shown: false };
      }
      const box = list.getBoundingClientRect();
      const rowBox = row.getBoundingClientRect();
      return {
        y: window.scrollY,
        shown: rowBox.top >= box.top - 1 && rowBox.bottom <= box.bottom + 1,
      };
    });
    moved.push(seen.y - expected);
    if (!seen.shown) hidden += 1;
  };
  await look(0);
  const keys: KeyInput[] = ['[', ']', 'ArrowRight', 'ArrowRight', '[', ']'];
  for (const [index, key] of keys.entries()) {
    const y = index % 2 === 0 ? 0 : 160;
    await page.evaluate((top) => {
      window.scrollTo(0, top);
    }, y);
    await page.keyboard.press(key);
    await wait(250);
    await look(y);
  }
  return { moved, hidden, seeks: keys.length };
}

interface FirstTab {
  page: string;
  header: string;
  control: string;
}

const focusedControl = (page: Page, name: string): Promise<FirstTab> =>
  page.evaluate((label) => {
    const active = document.activeElement;
    const header = active?.closest('header');
    return {
      page: label,
      header: header === null || header === undefined ? 'none' : (header.dataset.testid ?? 'site'),
      control: (active?.textContent ?? '').trim().slice(0, 24) || (active?.tagName ?? 'nothing'),
    };
  }, name);

// The reader clicks the page's top edge, the page lives on (a replay plays, the feed beats), then the first Tab lands in a header.
async function firstTab(page: Page, stub: StubApi, path: string, width: number): Promise<FirstTab> {
  const name = `${path.replace(stub.runId, '[id]')} at ${String(width)}`;
  await page.setViewport({ width, height: 844, deviceScaleFactor: 1 });
  await page.goto(`${BASE}${path}`, { waitUntil: 'load' });
  await wait(800);
  const spot = await page.evaluate(() => {
    const box = document.querySelector('header')?.getBoundingClientRect();
    if (box === undefined) return undefined;
    const point = { x: box.right - 6, y: box.top + 6 };
    const target = document.elementFromPoint(point.x, point.y);
    return target?.closest('a, button, [tabindex]') === null ? point : undefined;
  });
  if (spot === undefined) return { page: name, header: 'unclickable', control: '' };
  await page.mouse.click(spot.x, spot.y);
  if ((await page.$('[data-testid="replay-panel"]')) !== null) {
    const clock = (): Promise<string> =>
      page.evaluate(() => document.querySelector('[data-testid="clock"]')?.textContent ?? '');
    const before = await clock();
    // Space before hydration is lost, so press until the clock moves; a replay that never plays fails the check.
    for (let attempt = 0; attempt < 5 && (await clock()) === before; attempt += 1) {
      await page.keyboard.press(' ');
      await wait(1500);
    }
    if ((await clock()) === before) return { page: name, header: 'no replay', control: before };
    await page.keyboard.press(' ');
  }
  if (path === '/live') {
    stub.emit(fleetBeat(BEATS + 1));
    await wait(400);
  }
  await page.keyboard.press('Tab');
  return focusedControl(page, name);
}

// Arriving by a click on the run list leaves Chrome's focus starting point where the link was; nothing may move it.
async function clickThrough(page: Page, stub: StubApi): Promise<FirstTab> {
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
  await page.goto(`${BASE}/runs`, { waitUntil: 'load' });
  await page.click(`main a[href="/runs/${stub.runId}"]`);
  await page.waitForSelector('[data-testid="narrative-row"][data-current="true"]');
  await wait(800);
  await page.keyboard.press('Tab');
  return focusedControl(page, '/runs → /runs/[id] by a click');
}

const server = spawn('pnpm', ['exec', 'next', 'start', '--port', String(PORT)], {
  stdio: ['ignore', 'inherit', 'inherit'],
  env: {
    ...process.env,
    DEBRIEF_API_URL: `http://127.0.0.1:${String(API_PORT)}`,
    DEBRIEF_API_KEY: 'a11y',
  },
});
const failures: string[] = [];
const fail = (message: string): void => {
  console.error(`a11y-check: ${message}`);
  failures.push(message);
};
const stub = await startStubApi(API_PORT);
try {
  await ready();
  const browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: true,
    args: [
      '--no-sandbox',
      '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader',
      '--ignore-gpu-blocklist',
    ],
  });
  try {
    const page = await browser.newPage();
    await page.evaluateOnNewDocument(COUNT_FRAMES);
    const still = await liveMotion(page, stub, true);
    const moving = await liveMotion(page, stub, false);
    console.log(
      `live, reduced motion: ${still.motion}, ${String(BEATS)} beats drawn in ${String(still.drawn)} frames, ${String(still.idle)} animation frames while the feed was quiet, ${String(still.running)} CSS animations running, ${String(still.labels)} zone labels, ${String(still.received)} received; with motion: ${String(moving.idle)} animation frames while quiet`,
    );
    if (still.motion !== 'still') fail('/live did not see prefers-reduced-motion');
    if (still.idle !== 0) fail('/live draws animation frames under reduced motion');
    if (still.running !== 0) fail('/live runs CSS animations under reduced motion');
    if (still.drawn === 0 || still.labels === 0 || still.received < BEATS * 4) {
      fail('/live did not draw the feed under reduced motion');
    }
    if (moving.idle === 0) fail('/live does not animate without reduced motion');
    const transcript = await transcriptScroll(page, stub);
    console.log(
      `transcript at 390: window moved ${transcript.moved.join(' ')} px over the load and ${String(transcript.seeks)} seeks, current row hidden ${String(transcript.hidden)} times`,
    );
    if (transcript.moved.some((delta) => delta !== 0)) fail('the transcript scrolls the window');
    if (transcript.hidden !== 0) fail('the transcript does not show its current row');
    await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'no-preference' }]);
    const pages = ['', '/blast', '/lineage', '/evidence', '/branch'].map(
      (view) => `/runs/${stub.runId}${view}`,
    );
    const tabs: FirstTab[] = [];
    for (const path of ['/runs', ...pages, '/live', '/sessions/session-canvas']) {
      for (const width of [1440, 390]) tabs.push(await firstTab(page, stub, path, width));
    }
    tabs.push(await clickThrough(page, stub));
    console.log(
      `first Tab: ${tabs.map((tab) => `${tab.page} → ${tab.header} header "${tab.control}"`).join('; ')}`,
    );
    for (const tab of tabs.filter(
      (candidate) => !['site', 'run-header'].includes(candidate.header),
    )) {
      fail(
        `the first Tab on ${tab.page} did not land in a header (${tab.header}, "${tab.control}")`,
      );
    }
  } finally {
    await browser.close();
  }
} finally {
  server.kill('SIGTERM');
  await stub.close();
}
process.exit(failures.length === 0 ? 0 : 1);
