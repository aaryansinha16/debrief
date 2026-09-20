import { type Outcome, chainLinks, findHash, keyIdMatches, keyStatus, verifyZip } from './flow.js';
import {
  renderChain,
  renderChecks,
  renderHashMatch,
  renderKeyStatus,
  renderReport,
  renderSummary,
} from './render.js';
import './style.css';

const byId = (id: string): HTMLElement => {
  const element = document.getElementById(id);
  if (element === null) throw new Error(`missing #${id}`);
  return element;
};
const input = (id: string): HTMLInputElement => {
  const element = byId(id);
  if (!(element instanceof HTMLInputElement)) throw new Error(`#${id} is not an input`);
  return element;
};

const drop = byId('drop');
const file = input('file');
const result = byId('result');
const hashForm = byId('hash-form');
const hashInput = input('hash');
const hashOut = byId('hash-result');
const keyForm = byId('key-form');
const keyInput = input('api');
const keyOut = byId('key-result');

let current: Outcome | undefined;

declare global {
  interface Window {
    __verify?: { outcome: Outcome['kind']; seq?: number; links: number; lit: number };
  }
}

function show(outcome: Outcome): void {
  current = outcome;
  const parts = [renderSummary(outcome)];
  if (outcome.kind !== 'unreadable') {
    const links = chainLinks(outcome.bundle, outcome.verdict);
    parts.push(renderChain(links), renderChecks(outcome.verdict));
    if (!keyIdMatches(outcome.bundle)) {
      parts.push(
        '<p class="key broken" data-testid="key-derivation">✗ the manifest’s key id does not derive from its public key</p>',
      );
    }
    parts.push(renderReport(outcome.bundle));
    window.__verify = {
      outcome: outcome.kind,
      ...(outcome.kind === 'broken' && outcome.failedAt.seq !== undefined
        ? { seq: outcome.failedAt.seq }
        : {}),
      links: links.length,
      lit: links.filter((link) => link.state === 'ok').length,
    };
  } else {
    window.__verify = { outcome: 'unreadable', links: 0, lit: 0 };
  }
  result.innerHTML = parts.join('');
  hashOut.innerHTML = '';
  keyOut.innerHTML = '';
  document.body.dataset.outcome = outcome.kind;
}

async function load(blob: Blob): Promise<void> {
  drop.classList.add('busy');
  try {
    show(verifyZip(new Uint8Array(await blob.arrayBuffer())));
  } finally {
    drop.classList.remove('busy');
  }
}

file.addEventListener('change', () => {
  const picked = file.files?.[0];
  if (picked !== undefined) void load(picked);
});
for (const name of ['dragenter', 'dragover'] as const) {
  drop.addEventListener(name, (event) => {
    event.preventDefault();
    drop.classList.add('over');
  });
}
drop.addEventListener('dragleave', () => {
  drop.classList.remove('over');
});
drop.addEventListener('drop', (event) => {
  event.preventDefault();
  drop.classList.remove('over');
  const dropped = event.dataTransfer?.files[0];
  if (dropped !== undefined) void load(dropped);
});
drop.addEventListener('click', (event) => {
  if (event.target !== file) file.click();
});

hashForm.addEventListener('submit', (event) => {
  event.preventDefault();
  if (current === undefined || current.kind === 'unreadable') {
    hashOut.innerHTML =
      '<p class="hash-match muted" data-testid="hash-match">load a bundle first</p>';
    return;
  }
  hashOut.innerHTML = renderHashMatch(findHash(current.bundle, current.verdict, hashInput.value));
  const seq = hashOut.querySelector('[data-seq]')?.getAttribute('data-seq');
  result.querySelectorAll('.link.pinned').forEach((link) => {
    link.classList.remove('pinned');
  });
  if (seq !== null && seq !== undefined) {
    result.querySelector(`.link[data-seq="${seq}"]`)?.classList.add('pinned');
  }
});

// Optional and off until asked: the only network call, against the API's public keys document.
keyForm.addEventListener('submit', (event) => {
  event.preventDefault();
  if (current === undefined || current.kind === 'unreadable') {
    keyOut.innerHTML = '<p class="key muted" data-testid="key-status">load a bundle first</p>';
    return;
  }
  const bundle = current.bundle;
  const base = keyInput.value.trim().replace(/\/+$/, '');
  keyOut.innerHTML = '<p class="key muted" data-testid="key-status">fetching…</p>';
  fetch(`${base}/.well-known/debrief-keys.json`)
    .then(async (response) => {
      if (!response.ok) throw new Error(`${String(response.status)} from ${base}`);
      const document = (await response.json()) as { keys?: unknown };
      const keys = Array.isArray(document.keys) ? (document.keys as never[]) : [];
      keyOut.innerHTML = renderKeyStatus(keyStatus(bundle, keys));
    })
    .catch((error: unknown) => {
      keyOut.innerHTML = renderKeyStatus({
        kind: 'error',
        message: error instanceof Error ? error.message : 'unknown error',
      });
    });
});

const params = new URLSearchParams(window.location.search);
const api = params.get('api');
if (api !== null) keyInput.value = api;

// `?bundle=<url>` opens the verifier on a bundle a page linked to; the bytes are still verified here, only fetched from there.
const linked = params.get('bundle');
if (linked !== null) {
  result.innerHTML = '<p class="detail" data-testid="fetching">fetching the bundle…</p>';
  fetch(linked)
    .then(async (response) => {
      if (!response.ok) throw new Error(`${String(response.status)} from ${linked}`);
      show(verifyZip(new Uint8Array(await response.arrayBuffer())));
    })
    .catch((error: unknown) => {
      show({
        kind: 'unreadable',
        file: linked,
        message: error instanceof Error ? error.message : 'could not fetch',
      });
    });
}
