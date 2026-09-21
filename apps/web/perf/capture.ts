import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';

import { packBundle } from '@debrief/evidence';
import { demoBundle } from '@debrief/evidence/fixtures';
import puppeteer, { type Page } from 'puppeteer-core';

const PORT = Number(process.env.PERF_PORT ?? 3113);
const BASE = `http://127.0.0.1:${String(PORT)}`;
const OUT = new URL('../public/demo/', import.meta.url).pathname;
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
  console.error('capture: no Chrome found; set CHROME_PATH');
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

// A seek commits the DOM and the stage renders on demand: wait until no stage frame has run for a beat.
async function settle(page: Page): Promise<void> {
  let last = -1;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    await wait(40);
    const frames = await page.evaluate(() => window.__theatre?.frames ?? 0);
    if (frames === last) return;
    last = frames;
  }
}

// Seeking never freezes (a seek clears the freeze); the film holds the freeze frame for `FREEZE_HOLD_S` at the divergence.
const FREEZE_HOLD_S = 3;

mkdirSync(OUT, { recursive: true });
// The demo bundle the landing's CTA hands to the verifier: the fixture run, signed with the fixture key.
const demo = demoBundle();
writeFileSync(`${OUT}bundle.zip`, packBundle(demo.input, demo.sign));
console.log(
  `capture: wrote bundle.zip (${String(packBundle(demo.input, demo.sign).byteLength)} bytes)`,
);

const server = spawn('pnpm', ['exec', 'next', 'start', '--port', String(PORT)], {
  stdio: ['ignore', 'inherit', 'inherit'],
  env: { ...process.env, DEBRIEF_API_KEY: process.env.DEBRIEF_API_KEY ?? 'capture' },
});
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
      '--autoplay-policy=no-user-gesture-required',
    ],
  });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
    await page.goto(`${BASE}/perf/theatre`, { waitUntil: 'networkidle0' });
    await page.waitForFunction(() => window.__theatre?.freezeT !== undefined, {
      timeout: 30_000,
    });
    await page.evaluate(() => document.fonts.ready);
    await page.addStyleTag({
      content:
        '*, *::before, *::after { animation: none !important; transition: none !important; }',
    });
    const theatre = await page.$('[data-testid="theatre"]');
    if (theatre === null) throw new Error('no theatre');
    const fps = Number(process.env.CAPTURE_FPS ?? 30);
    const duration = await page.evaluate(() => window.__theatreDuration?.() ?? 0);
    const freezeT = await page.evaluate(() => window.__theatre?.freezeT ?? 0);
    const hold = 1.5;
    const total = Math.round((duration / 1000 + hold) * fps);
    // Frames are stills at deterministic clock positions; the freeze is held, then playback continues past it.
    const frames: string[] = [];
    let frozen = false;
    for (let index = 0; index < total; index += 1) {
      const t = Math.min(duration, (index / fps) * 1000);
      if (!frozen && t >= freezeT) {
        frozen = true;
        await page.evaluate(() => {
          window.__theatreFreeze?.();
        });
        await settle(page);
        const still = await theatre.screenshot({ type: 'jpeg', quality: 90, encoding: 'base64' });
        for (let held = 0; held < FREEZE_HOLD_S * fps; held += 1) {
          frames.push(`data:image/jpeg;base64,${still}`);
        }
      }
      await page.evaluate((at: number) => {
        window.__theatreSeek?.(at);
      }, t);
      await settle(page);
      const shot = await theatre.screenshot({ type: 'jpeg', quality: 90, encoding: 'base64' });
      frames.push(`data:image/jpeg;base64,${shot}`);
      if (index === 0) {
        await theatre.screenshot({ path: `${OUT}theatre-poster.jpg`, type: 'jpeg', quality: 85 });
      }
    }
    console.log(`capture: ${String(frames.length)} frames at ${String(fps)} fps`);
    // Encoded in a second page: a 2D canvas fed at the frame rate feeds MediaRecorder VP9 at 2 Mbps.
    const encoder = await browser.newPage();
    await encoder.setContent('<canvas id="stage"></canvas>');
    const base64 = await encoder.evaluate(
      async (images: string[], frameRate: number) => {
        const stage = document.querySelector('canvas');
        if (stage === null) throw new Error('no stage');
        const context = stage.getContext('2d');
        if (context === null) throw new Error('no 2d context');
        const first = await new Promise<HTMLImageElement>((resolve, reject) => {
          const image = new Image();
          image.onload = () => {
            resolve(image);
          };
          image.onerror = () => {
            reject(new Error('bad frame'));
          };
          image.src = images[0] ?? '';
        });
        stage.width = first.width;
        stage.height = first.height;
        const stream = stage.captureStream(0);
        const [track] = stream.getVideoTracks();
        const recorder = new MediaRecorder(stream, {
          mimeType: 'video/webm;codecs=vp9',
          videoBitsPerSecond: 2_000_000,
        });
        const chunks: Blob[] = [];
        recorder.ondataavailable = (event) => {
          if (event.data.size > 0) chunks.push(event.data);
        };
        const done = new Promise<string>((resolve, reject) => {
          recorder.onstop = () => {
            const reader = new FileReader();
            reader.onload = () => {
              const url = typeof reader.result === 'string' ? reader.result : '';
              resolve(url.split(',')[1] ?? '');
            };
            reader.onerror = () => {
              reject(new Error('could not read the recording'));
            };
            reader.readAsDataURL(new Blob(chunks, { type: 'video/webm' }));
          };
        });
        const decoded = await Promise.all(
          images.map(
            (src) =>
              new Promise<HTMLImageElement>((resolve, reject) => {
                const image = new Image();
                image.onload = () => {
                  resolve(image);
                };
                image.onerror = () => {
                  reject(new Error('bad frame'));
                };
                image.src = src;
              }),
          ),
        );
        recorder.start();
        let index = 0;
        await new Promise<void>((resolve) => {
          const timer = window.setInterval(() => {
            const image = decoded[index];
            if (image === undefined) {
              window.clearInterval(timer);
              recorder.stop();
              resolve();
              return;
            }
            context.drawImage(image, 0, 0);
            (track as CanvasCaptureMediaStreamTrack | undefined)?.requestFrame();
            index += 1;
          }, 1000 / frameRate);
        });
        return done;
      },
      frames,
      fps,
    );
    const bytes = Buffer.from(base64, 'base64');
    writeFileSync(`${OUT}theatre.webm`, bytes);
    console.log(
      `capture: wrote theatre.webm (${(bytes.byteLength / 1024 / 1024).toFixed(2)} MB, ${(frames.length / fps).toFixed(1)} s)`,
    );
    if (bytes.byteLength > 8 * 1024 * 1024) {
      console.error('capture: the video is over 8 MB');
      process.exitCode = 1;
    }
  } finally {
    await browser.close();
  }
} finally {
  server.kill('SIGTERM');
}
process.exit(process.exitCode ?? 0);
