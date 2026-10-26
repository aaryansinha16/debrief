import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium-browser',
  '/usr/bin/chromium',
].filter((candidate): candidate is string => candidate !== undefined);

const usage =
  'usage: tsx perf/screens.ts --base <url> --prefix <name> <path>=<slug> [...] [--out dir] [--full] [--phone-scale 1|2]';

function parse(argv: readonly string[]): {
  base: string;
  prefix: string;
  out: string;
  full: boolean;
  phoneScale: number;
  pages: { path: string; slug: string }[];
} {
  const flags = new Map<string, string>();
  const pages: { path: string; slug: string }[] = [];
  let full = false;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index] ?? '';
    if (arg === '--full') full = true;
    else if (arg.startsWith('--')) {
      flags.set(arg.slice(2), argv[index + 1] ?? '');
      index += 1;
    } else {
      // The slug follows the last "=", so a path may carry a query string.
      const split = arg.lastIndexOf('=');
      const path = arg.slice(0, split);
      const slug = arg.slice(split + 1);
      if (split <= 0 || slug === '') throw new Error(usage);
      pages.push({ path, slug });
    }
  }
  const base = flags.get('base');
  const prefix = flags.get('prefix');
  if (base === undefined || prefix === undefined || pages.length === 0) throw new Error(usage);
  const out =
    flags.get('out') ?? fileURLToPath(new URL('../../../docs/design/screens/', import.meta.url));
  const phoneScale = Number(flags.get('phone-scale') ?? 1);
  if (!(phoneScale >= 1)) throw new Error(usage);
  return { base, prefix, out, full, phoneScale, pages };
}

// Screenshots for a PR: every page at desktop 1440 and phone 390, named <prefix>-<slug>-<width>.png. Committed shots
// stay in history for good, so the phone shot is taken at 1x unless asked otherwise.
const options = parse(process.argv.slice(2));
const widths = [
  { width: 1440, height: 900, scale: 1 },
  { width: 390, height: 844, scale: options.phoneScale },
];
const chromePath = CHROME_CANDIDATES.find((candidate) => existsSync(candidate));
if (chromePath === undefined) {
  console.error('screens: no Chrome found; set CHROME_PATH');
  process.exit(2);
}
mkdirSync(options.out, { recursive: true });
const browser = await puppeteer.launch({ executablePath: chromePath, headless: true });
try {
  for (const { path, slug } of options.pages) {
    for (const { width, height, scale } of widths) {
      const page = await browser.newPage();
      await page.setViewport({ width, height, deviceScaleFactor: scale });
      await page.goto(new URL(path, options.base).href, { waitUntil: 'load' });
      await page.evaluate(() => document.fonts.ready);
      await new Promise((resolve) => setTimeout(resolve, 1200));
      // A page may scroll itself on load (the transcript follows the clock); shots start at the top.
      await page.evaluate(() => {
        window.scrollTo(0, 0);
      });
      await new Promise((resolve) => setTimeout(resolve, 200));
      const file = join(options.out, `${options.prefix}-${slug}-${String(width)}.png`);
      await page.screenshot({ path: file, fullPage: options.full });
      console.log(`screens: ${file}`);
      await page.close();
    }
  }
} finally {
  await browser.close();
}
