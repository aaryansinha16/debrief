import { mkdirSync, writeFileSync } from 'node:fs';

import { readEnv } from '../src/lib/env';
import { renderLanding } from '../src/lib/landing';

// Runs before build and dev: the landing is a static file under public/, rewritten from `/` by next.config.ts.
const out = new URL('../public/index.html', import.meta.url);
mkdirSync(new URL('../public/', import.meta.url), { recursive: true });
const html = renderLanding(readEnv().VERIFY_URL);
writeFileSync(out, html);
console.log(`landing: wrote public/index.html (${String(Buffer.byteLength(html))} bytes)`);
