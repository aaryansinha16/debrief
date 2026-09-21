import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import puppeteer, { type Page } from 'puppeteer-core';

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

const chromePath = CHROME_CANDIDATES.find((candidate) => existsSync(candidate));
if (chromePath === undefined) {
  console.error('theatre-check: no Chrome found; set CHROME_PATH');
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

declare global {
  interface Window {
    __theatre?: TheatreHandle;
  }
}

interface Frame {
  t: number;
  cursor: string;
  labels: number;
  unlabeled: number;
  states: string;
  caption: string;
  row: string | null;
  rowVisible: boolean;
  pageHeight: number;
  viewport: number;
  stage: string;
}

// A seek commits a frame from the clock subscription and the stage renders on demand; wait until no frame has run for a beat.
async function settle(page: Page): Promise<void> {
  let last = -1;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    await wait(150);
    const frames = await page.evaluate(() => window.__theatre?.frames ?? 0);
    if (frames === last) return;
    last = frames;
  }
  throw new Error('the stage never settled');
}

// The stage after a seek, once React has committed and the canvas has drawn: everything the check compares between two visits to the same t.
async function frameAt(page: Page, t: number): Promise<Frame> {
  await page.evaluate((at: number) => {
    window.__theatreSeek?.(at);
  }, t);
  await settle(page);
  const dom = await page.evaluate((at: number) => {
    const labels = Array.from(document.querySelectorAll('[data-testid="node-label"]'));
    const list = document.querySelector('[data-testid="narrative"] ol');
    const row = document.querySelector('[data-testid="narrative-row"][data-current="true"]');
    const listRect = list?.getBoundingClientRect();
    const rowRect = row?.getBoundingClientRect();
    return {
      t: at,
      cursor:
        document.querySelector('[data-testid="cursor-node"]')?.getAttribute('data-node') ?? '',
      labels: labels.length,
      unlabeled: labels.filter((label) => label.textContent.trim() === '').length,
      states: labels
        .map(
          (label) =>
            `${label.getAttribute('data-node') ?? ''}=${label.getAttribute('data-state') ?? ''}`,
        )
        .join(','),
      caption: document.querySelector('[data-testid="caption"]')?.textContent ?? '',
      row: row?.getAttribute('data-seq') ?? null,
      rowVisible:
        listRect !== undefined &&
        rowRect !== undefined &&
        rowRect.top >= listRect.top - 1 &&
        rowRect.bottom <= listRect.bottom + 1,
      pageHeight: document.documentElement.scrollHeight,
      viewport: window.innerHeight,
    };
  }, t);
  const canvas = await page.$('[data-testid="stage-3d"] canvas');
  const stage = canvas === null ? '' : await canvas.screenshot({ type: 'png', encoding: 'base64' });
  return { ...dom, stage };
}

const server = spawn('pnpm', ['exec', 'next', 'start', '--port', String(PORT)], {
  stdio: ['ignore', 'inherit', 'inherit'],
  env: { ...process.env, DEBRIEF_API_KEY: process.env.DEBRIEF_API_KEY ?? 'theatre' },
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
  mkdirSync(OUT, { recursive: true });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
    await page.goto(`${BASE}/perf/theatre`, { waitUntil: 'networkidle0' });
    await page.waitForFunction(() => window.__theatre?.freezeT !== undefined, {
      timeout: 30_000,
    });
    await page.addStyleTag({
      content:
        '*, *::before, *::after { animation: none !important; transition: none !important; }',
    });
    // Labels are DOM: the first frame must not be compared in the fallback font while the web font is still loading.
    await page.evaluate(() => document.fonts.ready);
    const duration = await page.evaluate(() => window.__theatreDuration?.() ?? 0);
    const freezeT = await page.evaluate(() => window.__theatre?.freezeT ?? 0);
    // Determinism: the same t renders the same stage, whatever was shown in between (D-069).
    const probes = [0, freezeT / 3, freezeT, duration];
    const first: Frame[] = [];
    for (const t of probes) first.push(await frameAt(page, t));
    const second: Frame[] = [];
    for (const t of [...probes].reverse()) second.unshift(await frameAt(page, t));
    const drawCalls = await page.evaluate(() => window.__theatre?.drawCalls ?? 0);
    // Labels are DOM text clipped at the stage edge: a few antialiased pixels may differ, a moved camera or lit node cannot.
    const differs = async (a: Frame, b: Frame): Promise<boolean> => {
      if (a.states !== b.states || a.cursor !== b.cursor) return true;
      if (a.stage === b.stage) return false;
      const diff = await page.evaluate(
        async (left: string, right: string) => {
          const load = (source: string): Promise<HTMLImageElement> =>
            new Promise((resolve) => {
              const image = new Image();
              image.onload = () => {
                resolve(image);
              };
              image.src = `data:image/png;base64,${source}`;
            });
          const [ia, ib] = await Promise.all([load(left), load(right)]);
          const canvas = document.createElement('canvas');
          canvas.width = ia.width;
          canvas.height = ia.height;
          const context = canvas.getContext('2d');
          if (context === null) return { changed: 1, total: 1 };
          context.drawImage(ia, 0, 0);
          const da = context.getImageData(0, 0, canvas.width, canvas.height).data;
          context.drawImage(ib, 0, 0);
          const db = context.getImageData(0, 0, canvas.width, canvas.height).data;
          let changed = 0;
          for (let i = 0; i < da.length; i += 4) {
            const delta =
              Math.abs((da[i] ?? 0) - (db[i] ?? 0)) +
              Math.abs((da[i + 1] ?? 0) - (db[i + 1] ?? 0)) +
              Math.abs((da[i + 2] ?? 0) - (db[i + 2] ?? 0));
            if (delta > 48) changed += 1;
          }
          return { changed, total: da.length / 4 };
        },
        a.stage,
        b.stage,
      );
      return diff.changed > diff.total * 0.002;
    };
    const drift: number[] = [];
    for (const [index, t] of probes.entries()) {
      const a = first[index];
      const b = second[index];
      if (a !== undefined && b !== undefined && (await differs(a, b))) {
        drift.push(t);
        writeFileSync(`${OUT}drift-a.png`, Buffer.from(a.stage, 'base64'));
        writeFileSync(`${OUT}drift-b.png`, Buffer.from(b.stage, 'base64'));
      }
    }
    const tallest = Math.max(...first.map((frame) => frame.pageHeight));
    const viewport = first[0]?.viewport ?? 0;
    console.log(
      `theatre: ${String(first[0]?.labels)} nodes labeled (${String(first[0]?.unlabeled)} blank), ${(duration / 1000).toFixed(1)} s in story time, freeze at ${(freezeT / 1000).toFixed(2)} s, page ${String(tallest)} px in a ${String(viewport)} px viewport, ${String(drift.length)} frames drifted between visits (states, cursor and stage pixels within tolerance), ${String(drawCalls)} draw calls at most`,
    );
    if (
      (first[0]?.labels ?? 0) === 0 ||
      (first[0]?.unlabeled ?? 1) > 0 ||
      (first[0]?.stage ?? '') === '' ||
      duration < 15_000 ||
      tallest > viewport ||
      drift.length > 0 ||
      drawCalls === 0 ||
      drawCalls > 200
    ) {
      console.error(
        'theatre-check: the stage is not labeled, not deterministic, or grows the page',
      );
      failed = true;
    }
    // Every visited t shows the same event on the map, in the caption and in the transcript, with the row in view.
    for (const frame of first.slice(1)) {
      const seq = /#(\d+)/.exec(frame.caption)?.[1];
      if (frame.cursor === '' || seq === undefined || frame.row !== seq || !frame.rowVisible) {
        console.error(
          `theatre-check: at ${String(frame.t)} ms the cursor (${frame.cursor}), caption (#${String(seq)}) and transcript row (#${String(frame.row)}, visible=${String(frame.rowVisible)}) disagree`,
        );
        failed = true;
      }
    }
    // The freeze: playback lands on the divergence, pauses, and the split reads at 1280×800.
    const wide = await browser.newPage();
    await wide.setViewport({ width: 1280, height: 800, deviceScaleFactor: 1 });
    await wide.goto(`${BASE}/perf/theatre`, { waitUntil: 'networkidle0' });
    await wide.waitForFunction(() => window.__theatre?.freezeT !== undefined, {
      timeout: 30_000,
    });
    await wide.evaluate(() => {
      window.__theatrePlay?.(8);
    });
    await wide.waitForSelector('[data-testid="freeze-frame"]', { timeout: 30_000 });
    await wait(200);
    const freeze = await wide.evaluate(() => {
      const frame = document.querySelector('[data-testid="freeze-frame"]');
      const stage = document.querySelector('[data-testid="theatre-grid"]');
      const policy = document.querySelector('[data-testid="freeze-policy"]');
      const action = document.querySelector('[data-testid="freeze-action"]');
      // Section labels (h3) are the 11 px tracked caps of the type scale; the content itself must read at 13 px or more.
      const sizes = Array.from(frame?.querySelectorAll('p, pre, dd, dt, h2, button') ?? []).map(
        (node) => Number.parseFloat(getComputedStyle(node).fontSize),
      );
      const outer = stage?.getBoundingClientRect();
      // Named inner functions trip esbuild's keep-names helper inside evaluate; the rect test is inlined per element.
      const [policyInside, actionInside, frameInside] = [policy, action, frame].map((node) => {
        const rect = node?.getBoundingClientRect();
        return (
          outer !== undefined &&
          rect !== undefined &&
          rect.left >= outer.left &&
          rect.right <= outer.right + 1 &&
          rect.top >= outer.top &&
          rect.bottom <= outer.bottom + 1
        );
      });
      return {
        seq: frame?.getAttribute('data-seq'),
        captionSeq: /#(\d+)/.exec(
          document.querySelector('[data-testid="caption"]')?.textContent ?? '',
        )?.[1],
        playing: document.querySelector('[aria-pressed]')?.getAttribute('aria-pressed'),
        minFont: Math.min(...sizes),
        columns: [policy, action].map((node, index) => ({
          width: node?.getBoundingClientRect().width ?? 0,
          inside: (index === 0 ? policyInside : actionInside) === true,
          overflow: (node?.scrollWidth ?? 0) > (node?.clientWidth ?? 0),
        })),
        frameInside: frameInside === true,
      };
    });
    writeFileSync(`${OUT}freeze.png`, await wide.screenshot({ type: 'png' }));
    const readable =
      freeze.columns.every((column) => column.width >= 400 && column.inside && !column.overflow) &&
      freeze.minFont >= 13 &&
      freeze.frameInside;
    console.log(
      `freeze: seq ${String(freeze.seq)} (caption #${String(freeze.captionSeq)}), playing=${String(freeze.playing)}, columns ${freeze.columns.map((column) => String(Math.round(column.width))).join('/')} px, min font ${String(freeze.minFont)} px, ${readable ? 'readable over the stage' : 'NOT readable'} at 1280×800`,
    );
    if (
      freeze.seq === null ||
      freeze.seq !== freeze.captionSeq ||
      freeze.playing !== 'false' ||
      !readable
    ) {
      console.error('theatre-check: the freeze frame failed');
      failed = true;
    }
    // Dispatched in the page: a synthetic pointer click can miss while the runner's compositor lags behind.
    await wide.evaluate(() => {
      document.querySelector<HTMLButtonElement>('[data-testid="continue"]')?.click();
    });
    await wide.waitForFunction(
      () => document.querySelector('[data-testid="freeze-frame"]') === null,
      { timeout: 10_000 },
    );
    // The runner throttles requestAnimationFrame in a second tab, so the ripple is stepped by seeking, not by playing.
    await wide.evaluate((at: number) => {
      window.__theatreSeek?.(at);
    }, freezeT + 1500);
    await wait(100);
    await settle(wide);
    const after = await wide.evaluate(() => ({
      frozen: document.querySelector('[data-testid="freeze-frame"]') !== null,
      burnt: document.querySelectorAll('[data-testid="node-label"][data-state="burnt"]').length,
      hotZone: document
        .querySelector('[data-testid="zone-label"][data-zone="production"]')
        ?.className.includes('text-ember'),
    }));
    writeFileSync(`${OUT}ripple.png`, await wide.screenshot({ type: 'png' }));
    console.log(
      `ripple: ${String(after.burnt)} nodes burnt after continue, production zone lit ${String(after.hotZone)}`,
    );
    if (after.frozen || after.burnt < 2) {
      console.error('theatre-check: continuing past the freeze did not ripple');
      failed = true;
    }
    await wide.close();
    writeFileSync(`${OUT}theatre.png`, await page.screenshot({ type: 'png' }));
    await page.close();
    // The blast scene: the ripple settles on its own, lights every affected resource, and stays within the same budget.
    const blastPage = await browser.newPage();
    await blastPage.setViewport({ width: 1280, height: 800, deviceScaleFactor: 1 });
    await blastPage.goto(`${BASE}/perf/blast`, { waitUntil: 'networkidle0' });
    await blastPage.waitForFunction(() => window.__blast?.done === true, { timeout: 30_000 });
    const blast = await blastPage.evaluate(() => ({
      handle: window.__blast,
      unlit: document.querySelectorAll('[data-testid="affected-resource"][data-lit="no"]').length,
      rows: document.querySelectorAll('[data-testid="affected-resource"]').length,
      status: document.querySelector('[data-testid="ripple-wave"]')?.textContent ?? '',
    }));
    writeFileSync(`${OUT}blast.png`, await blastPage.screenshot({ type: 'png' }));
    console.log(
      `blast: ${String(blast.handle?.hops)} waves settled at progress ${String(blast.handle?.progress)} over ${String(blast.handle?.frames)} frames, ${String(blast.rows)} resources lit, ${String(blast.handle?.drawCalls)} draw calls at most ("${blast.status}")`,
    );
    if (
      blast.handle === undefined ||
      blast.handle.hops < 1 ||
      blast.handle.progress !== blast.handle.hops + 1 ||
      blast.handle.drawCalls > 200 ||
      blast.unlit > 0 ||
      blast.rows === 0
    ) {
      console.error('theatre-check: blast scene did not settle within budget');
      failed = true;
    }
    await blastPage.close();
    // P-41: editing the sample policy re-branches within 500 ms of the last keystroke; broken YAML shows line-anchored errors.
    const branchPage = await browser.newPage();
    await branchPage.setViewport({ width: 1280, height: 900, deviceScaleFactor: 1 });
    await branchPage.goto(`${BASE}/perf/branch`, { waitUntil: 'networkidle0' });
    const branchState = () =>
      branchPage.evaluate(() => {
        const scene = document.querySelector('[data-testid="branch-scene"]');
        return {
          halted: scene?.getAttribute('data-halted'),
          valid: scene?.getAttribute('data-valid'),
          pending: scene?.getAttribute('data-pending'),
          ms: Number(scene?.getAttribute('data-rebranch-ms') ?? Number.NaN),
          greyed: document.querySelectorAll('[data-status="would-not-have-happened"]').length,
          issues: Array.from(document.querySelectorAll('[data-testid="policy-issues"] li')).map(
            (item) => item.textContent,
          ),
          flagged: document.querySelectorAll('[data-testid="gutter"] [data-issue="yes"]').length,
        };
      });
    const before = await branchState();
    await branchPage.evaluate(() => {
      const editor = document.querySelector<HTMLTextAreaElement>('[data-testid="policy-editor"]');
      editor?.focus();
      editor?.select();
    });
    await branchPage.keyboard.type('version: 1\ndefaults: allow\nrules: []\n');
    await branchPage.waitForFunction(
      () => {
        const scene = document.querySelector('[data-testid="branch-scene"]');
        return (
          scene?.getAttribute('data-pending') === 'no' &&
          scene.getAttribute('data-rebranch-ms') !== ''
        );
      },
      { timeout: 10_000 },
    );
    const rebranched = await branchState();
    await branchPage.keyboard.type('  - id: broken\n    effect: nope\n');
    await branchPage.waitForFunction(
      () => document.querySelector('[data-testid="policy-issues"] li') !== null,
      { timeout: 5000 },
    );
    const broken = await branchState();
    writeFileSync(`${OUT}branch.png`, await branchPage.screenshot({ type: 'png' }));
    console.log(
      `branch: halted ${String(before.halted)} with ${String(before.greyed)} greyed → allow-all re-branched in ${String(rebranched.ms)} ms (halted ${String(rebranched.halted)}, ${String(rebranched.greyed)} greyed); broken yaml: ${String(broken.issues.length)} issues, ${String(broken.flagged)} lines flagged ("${broken.issues[0] ?? ''}")`,
    );
    if (
      before.halted !== 'yes' ||
      before.greyed === 0 ||
      rebranched.halted !== 'no' ||
      rebranched.greyed !== 0 ||
      !(rebranched.ms < 500) ||
      broken.valid !== 'no' ||
      broken.issues.length === 0 ||
      broken.flagged === 0 ||
      !/^line \d+:\d+ · /.test(broken.issues[0] ?? '')
    ) {
      console.error(
        'theatre-check: the branch editor did not re-branch in time or hide its errors',
      );
      failed = true;
    }
    await branchPage.close();
  } finally {
    await browser.close();
  }
} finally {
  server.kill('SIGTERM');
}
process.exit(failed ? 1 : 0);
