import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import puppeteer, { type Browser } from 'puppeteer-core';

import type { ApproachPerf } from '../src/scenes/approach-probe';
import type { PerfResult } from '../src/scenes/perf-probe';

const PORT = Number(process.env.PERF_PORT ?? 3111);
const BASE = `http://127.0.0.1:${String(PORT)}`;
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
  console.error('perf-smoke: no Chrome found; set CHROME_PATH');
  process.exit(2);
}

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

async function ready(): Promise<void> {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
      const response = await fetch(`${BASE}/live`);
      if (response.ok) return;
    } catch {
      /* not up yet */
    }
    await wait(500);
  }
  throw new Error('web did not start');
}

async function measure(browser: Browser, query: string, seconds: number): Promise<PerfResult> {
  const page = await browser.newPage();
  await page.setViewport({ width: 960, height: 640, deviceScaleFactor: 1 });
  await page.goto(`${BASE}/perf/graph?${query}&seconds=${String(seconds)}`, {
    waitUntil: 'networkidle0',
  });
  await page.waitForFunction(() => window.__perf?.done === true, {
    timeout: (seconds + 30) * 1000,
  });
  const result = await page.evaluate(() => window.__perf);
  await page.close();
  if (result === undefined) throw new Error(`no result for ${query}`);
  return result;
}

async function measureApproach(
  browser: Browser,
  agents: number,
  seconds: number,
): Promise<ApproachPerf> {
  const page = await browser.newPage();
  await page.setViewport({ width: 960, height: 640, deviceScaleFactor: 1 });
  await page.goto(`${BASE}/perf/approach?agents=${String(agents)}&seconds=${String(seconds)}`, {
    waitUntil: 'networkidle0',
  });
  await page.waitForFunction(() => window.__approach?.done === true, {
    timeout: (seconds + 30) * 1000,
  });
  const result = await page.evaluate(() => window.__approach);
  await page.close();
  if (result === undefined) throw new Error(`no result for ${String(agents)} agents`);
  return result;
}

const server = spawn('pnpm', ['exec', 'next', 'start', '--port', String(PORT)], {
  stdio: ['ignore', 'inherit', 'inherit'],
  env: { ...process.env, DEBRIEF_API_KEY: process.env.DEBRIEF_API_KEY ?? 'perf' },
});
let failed = false;
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
    // Judged on the median frame: a shared runner stalls for tens of milliseconds at a time, which the mean would count.
    const medianFps = (result: { p50Ms: number }): number =>
      result.p50Ms === 0 ? 0 : 1000 / result.p50Ms;
    const demoBudget = Number(process.env.PERF_DEMO_FPS ?? 58);
    const syntheticBudget = Number(process.env.PERF_SYNTHETIC_FPS ?? 45);
    const approachBudget = Number(process.env.PERF_APPROACH_FPS ?? 45);
    const pulseBudget = Number(process.env.PERF_PULSE_MS ?? 200);
    // A frame that misses the 60 Hz deadline reads as a 33 ms interval; a rAF timestamp jitters by about a millisecond around vsync (D-057).
    const frameBudget = Number(process.env.PERF_FRAME_P95_MS ?? 18);
    const measureUntil = async (
      query: string,
      budget: number,
      p95Budget = Number.POSITIVE_INFINITY,
    ): Promise<PerfResult> => {
      const first = await measure(browser, query, 6);
      return medianFps(first) >= budget && first.p95Ms <= p95Budget
        ? first
        : measure(browser, query, 6);
    };
    const demo = await measureUntil('fixture=demo', demoBudget, frameBudget);
    const synthetic = await measureUntil('nodes=5000', syntheticBudget);
    // Cost is a second pass with the raster awaited inside each render call: informational on the shared runner, where the wait is scheduling-bound (D-057).
    const demoCost = await measure(browser, 'fixture=demo&sync=1', 6);
    const syntheticCost = await measure(browser, 'nodes=5000&sync=1', 6);
    // P-39: five thousand simulated agents on approach, and the pulse of a critical event drawn within the budget.
    const firstApproach = await measureApproach(browser, 5000, 6);
    const approach =
      medianFps(firstApproach) >= approachBudget
        ? firstApproach
        : await measureApproach(browser, 5000, 6);
    const line = (name: string, result: PerfResult): string =>
      `${name}: ${String(result.nodes)} nodes, ${String(result.edges)} edges, ${medianFps(result).toFixed(1)} fps median (${result.fps.toFixed(1)} mean, p95 frame ${result.p95Ms.toFixed(1)} ms, ${String(result.frames)} frames, ${String(result.drawCalls)} draw calls) on ${result.renderer}`;
    const cost = (name: string, result: PerfResult): string =>
      `${name} cost: render p50 ${result.renderP50Ms.toFixed(1)} ms, p95 ${result.renderP95Ms.toFixed(1)} ms with the raster awaited (${String(result.frames)} frames)`;
    console.log(line('demo', demo));
    console.log(line('synthetic', synthetic));
    console.log(cost('demo', demoCost));
    console.log(cost('synthetic', syntheticCost));
    console.log(
      `approach: ${String(approach.agents)} agents, ${medianFps(approach).toFixed(1)} fps median (${approach.fps.toFixed(1)} mean, p95 frame ${approach.p95Ms.toFixed(1)} ms, ${String(approach.frames)} frames, ${String(approach.drawCalls)} draw calls, render p50 ${approach.renderP50Ms.toFixed(1)} ms); ${String(approach.pulses)} pulses drawn within ${approach.pulseMaxMs.toFixed(0)} ms at most (p95 ${approach.pulseP95Ms.toFixed(0)} ms)`,
    );
    if (process.env.PERF_DIAG === '1') {
      console.log(cost('floor (1 node)', await measure(browser, 'nodes=1&sync=1', 3)));
      console.log(
        cost('demo nodes only', await measure(browser, 'fixture=demo&layers=nodes&sync=1', 3)),
      );
      console.log(
        cost('demo edges only', await measure(browser, 'fixture=demo&layers=edges&sync=1', 3)),
      );
      console.log(line('nodes only', await measure(browser, 'nodes=5000&layers=nodes', 3)));
      console.log(line('edges only', await measure(browser, 'nodes=5000&layers=edges', 3)));
    }
    // requestAnimationFrame caps at 60 Hz, so a 60 fps budget reads as ≥ 58 fps at the median.
    if (medianFps(demo) < demoBudget) {
      console.error(`perf-smoke: demo graph below ${String(demoBudget)} fps`);
      failed = true;
    }
    if (medianFps(synthetic) < syntheticBudget) {
      console.error(`perf-smoke: 5k synthetic nodes below ${String(syntheticBudget)} fps`);
      failed = true;
    }
    // ARCHITECTURE §11 budget: the demo run's p95 frame within the 60 Hz deadline and no scene over 200 draw calls.
    if (demo.p95Ms > frameBudget) {
      console.error(`perf-smoke: demo p95 frame interval above ${String(frameBudget)} ms`);
      failed = true;
    }
    for (const [name, result] of [
      ['demo', demo],
      ['synthetic', synthetic],
      ['approach', approach],
    ] as const) {
      if (result.drawCalls > 200) {
        console.error(`perf-smoke: ${name} scene draws ${String(result.drawCalls)} calls`);
        failed = true;
      }
    }
    if (medianFps(approach) < approachBudget) {
      console.error(`perf-smoke: 5k simulated agents below ${String(approachBudget)} fps`);
      failed = true;
    }
    if (approach.pulses === 0 || approach.pulseMaxMs > pulseBudget) {
      console.error(
        `perf-smoke: a critical event took more than ${String(pulseBudget)} ms to pulse`,
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
