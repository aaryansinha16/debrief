import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

import { FILES, packBundle } from '@debrief/evidence';
import { demoBundle } from '@debrief/evidence/fixtures';
import { unzipSync, zipSync } from 'fflate';
import puppeteer, { type Page } from 'puppeteer-core';

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
  console.error('verify-check: no Chrome found; set CHROME_PATH');
  process.exit(2);
}

const dist = new URL('../dist/index.html', import.meta.url);
if (!existsSync(dist))
  execFileSync('pnpm', ['build'], { cwd: new URL('..', import.meta.url), stdio: 'inherit' });
const html = readFileSync(dist);
const gzipped = gzipSync(html).byteLength;
const budget = Number(process.env.VERIFY_GZIP_KB ?? 300) * 1024;

const demo = demoBundle();
const good = packBundle(demo.input, demo.sign);
const files = unzipSync(good);
const eventsText = new TextDecoder().decode(files[FILES.events] ?? new Uint8Array());
const lines = eventsText.trimEnd().split('\n');
const target = JSON.parse(lines[7] ?? '{}') as { seq: number; hash: string; summary?: string };
const probe = JSON.parse(lines[3] ?? '{}') as { hash: string };
lines[7] = JSON.stringify({ ...target, summary: 'a different story' });
const edited = zipSync({
  ...files,
  [FILES.events]: new TextEncoder().encode(`${lines.join('\n')}\n`),
});
const whitespace = zipSync({
  ...files,
  [FILES.events]: new TextEncoder().encode(`${eventsText}\n`),
});

const dir = mkdtempSync(join(tmpdir(), 'debrief-verify-'));
const paths = {
  good: join(dir, 'good.zip'),
  edited: join(dir, 'edited.zip'),
  whitespace: join(dir, 'whitespace.zip'),
  junk: join(dir, 'junk.zip'),
};
writeFileSync(paths.good, good);
writeFileSync(paths.edited, edited);
writeFileSync(paths.whitespace, whitespace);
writeFileSync(paths.junk, new Uint8Array([1, 2, 3, 4]));

interface Seen {
  outcome: string;
  seq?: number;
  links: number;
  lit: number;
  verdict: string;
  chain: number;
  broken: string | null;
  unreached: number;
}

async function upload(page: Page, path: string): Promise<Seen> {
  const input = await page.$('input[data-testid="file"]');
  if (input === null) throw new Error('no file input');
  await input.uploadFile(path);
  await page.waitForFunction(() => window.__verify !== undefined, { timeout: 30_000 });
  const seen = await page.evaluate(() => {
    const state = window.__verify;
    const links = document.querySelectorAll('[data-testid="chain"] .link');
    return {
      outcome: state?.outcome ?? 'none',
      ...(state?.seq === undefined ? {} : { seq: state.seq }),
      links: state?.links ?? 0,
      lit: state?.lit ?? 0,
      verdict: document.querySelector('[data-testid="verdict"]')?.textContent ?? '',
      chain: links.length,
      broken: document.querySelector('.link.broken')?.getAttribute('data-seq') ?? null,
      unreached: document.querySelectorAll('.link.unreached').length,
    };
  });
  await page.evaluate(() => {
    window.__verify = undefined;
  });
  return seen;
}

let failed = false;
const browser = await puppeteer.launch({
  executablePath: chromePath,
  headless: true,
  args: ['--no-sandbox', '--allow-file-access-from-files'],
});
try {
  const page = await browser.newPage();
  const errors: string[] = [];
  page.on('pageerror', (error: unknown) => {
    errors.push(error instanceof Error ? error.message : String(error));
  });
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.goto(dist.href, { waitUntil: 'load' });
  const origin = await page.evaluate(() => window.location.protocol);
  const verified = await upload(page, paths.good);
  console.log(
    `verify: ${origin} ${verified.outcome} · ${String(verified.lit)}/${String(verified.links)} links lit · "${verified.verdict.slice(0, 60)}"`,
  );
  if (
    origin !== 'file:' ||
    verified.outcome !== 'verified' ||
    verified.lit !== verified.links ||
    verified.chain !== verified.links
  ) {
    console.error('verify-check: the demo bundle did not verify from file://');
    failed = true;
  }
  const seq = await upload(page, paths.edited);
  console.log(
    `tampered event: ${seq.outcome} at seq ${String(seq.seq)} · broken link #${String(seq.broken)} · ${String(seq.unreached)} unreached · "${seq.verdict.slice(0, 70)}"`,
  );
  if (
    seq.outcome !== 'broken' ||
    seq.seq !== target.seq ||
    seq.broken !== String(target.seq) ||
    seq.unreached === 0
  ) {
    console.error(`verify-check: expected the broken seq ${String(target.seq)} to be pinned`);
    failed = true;
  }
  const bytes = await upload(page, paths.whitespace);
  console.log(`tampered byte: ${bytes.outcome} · "${bytes.verdict.slice(0, 80)}"`);
  if (bytes.outcome !== 'broken' || !bytes.verdict.includes('events.jsonl')) {
    console.error('verify-check: a whitespace change in events.jsonl was not caught');
    failed = true;
  }
  const junk = await upload(page, paths.junk);
  console.log(`junk: ${junk.outcome} · "${junk.verdict.slice(0, 60)}"`);
  if (junk.outcome !== 'unreadable') {
    console.error('verify-check: junk was not reported as unreadable');
    failed = true;
  }
  await upload(page, paths.good);
  await page.type('[data-testid="hash"]', probe.hash);
  await page.click('[data-testid="hash-submit"]');
  const match = await page.evaluate(() => ({
    text: document.querySelector('[data-testid="hash-match"]')?.textContent ?? '',
    pinned: document.querySelector('.link.pinned')?.getAttribute('data-seq') ?? null,
  }));
  console.log(`hash: "${match.text.slice(0, 70)}" · pinned #${String(match.pinned)}`);
  if (!match.text.startsWith('✓ event') || match.pinned === null) {
    console.error('verify-check: pasting an event hash did not pin its link');
    failed = true;
  }
  console.log(
    `size: ${(gzipped / 1024).toFixed(1)} kB gzipped (budget ${String(budget / 1024)} kB)`,
  );
  if (gzipped > budget) {
    console.error('verify-check: the verifier is over its size budget');
    failed = true;
  }
  if (errors.length > 0) {
    console.error(`verify-check: page errors: ${errors.join(' | ')}`);
    failed = true;
  }
} finally {
  await browser.close();
}
process.exit(failed ? 1 : 0);
