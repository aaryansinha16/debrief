import { appendFileSync, chmodSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { writeConfig } from './config.js';
import type { GitRunner } from './git.js';
import { runHook, transcriptBatches } from './hook.js';
import { readState } from './session-state.js';

const SESSION = '5d1c7a90-1b2e-4c3d-9e8f-0a1b2c3d4e5f';
const KEY = `dbf_${'k'.repeat(43)}`;

const said = (n: number): string =>
  `${JSON.stringify({
    type: 'assistant',
    uuid: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
    timestamp: '2026-10-26T09:15:02.123Z',
    message: { role: 'assistant', content: [{ type: 'text', text: `step ${String(n)}` }] },
  })}\n`;

const noGit: GitRunner = () => Promise.resolve({ ok: false });
const fakeGit =
  (head: string): GitRunner =>
  (args) => {
    const out: Record<string, string> = {
      'rev-parse --show-toplevel': '/work/app\n',
      'rev-parse --verify -q HEAD': `${head}\n`,
      'symbolic-ref --short -q HEAD': 'main\n',
    };
    return Promise.resolve({ ok: true, out: out[args.join(' ')] ?? '' });
  };

function setup() {
  const root = mkdtempSync(join(tmpdir(), 'debrief-hook-'));
  const configDir = join(root, 'debrief');
  writeConfig(configDir, { apiUrl: 'http://api.test', key: KEY, keyId: 'k1' });
  const transcript = join(root, `${SESSION}.jsonl`);
  writeFileSync(transcript, '');
  const input = {
    session_id: SESSION,
    transcript_path: transcript,
    cwd: root,
    hook_event_name: 'Stop',
  };
  const posted: string[][] = [];
  let reply: (ids: string[]) => Promise<Response> = () =>
    Promise.resolve(Response.json({ accepted: 1, duplicates: 0 }));
  const fetch = ((_url: string, init: RequestInit) => {
    const body = JSON.parse(init.body as string) as { events: { sourceId: string }[] };
    const ids = body.events.map((event) => event.sourceId);
    posted.push(ids);
    return reply(ids);
  }) as typeof globalThis.fetch;
  const setReply = (next: (ids: string[]) => Promise<Response>) => {
    reply = next;
  };
  return { configDir, transcript, input, posted, fetch, setReply, log: [] as string[] };
}

describe('runHook', () => {
  it('posts new lines once, then the git state only when it changed', async () => {
    const t = setup();
    writeFileSync(t.transcript, said(1) + said(2));
    const options = { configDir: t.configDir, fetch: t.fetch, git: fakeGit('a'.repeat(40)) };
    expect(await runHook(t.input, options)).toMatchObject({ status: 'done', accepted: 2 });
    expect(t.posted).toEqual([
      ['00000000-0000-4000-8000-000000000001:0', '00000000-0000-4000-8000-000000000002:0'],
      [expect.stringMatching(new RegExp(`^git:${SESSION}:0:[0-9a-f]{32}$`))],
    ]);
    expect(await runHook(t.input, options)).toMatchObject({ status: 'done', accepted: 0 });
    expect(t.posted).toHaveLength(2);
    appendFileSync(t.transcript, said(3) + '{"type":"assistant"');
    await runHook(t.input, { ...options, git: fakeGit('b'.repeat(40)) });
    expect(t.posted.slice(2)).toEqual([
      ['00000000-0000-4000-8000-000000000003:0'],
      [expect.stringMatching(/^git:/)],
    ]);
  });

  it('stores every git change when the tree toggles between two states', async () => {
    const t = setup();
    const seen = new Set<string>();
    t.setReply((ids) => {
      const fresh = ids.filter((id) => !seen.has(id));
      for (const id of fresh) seen.add(id);
      return Promise.resolve(
        Response.json({ accepted: fresh.length, duplicates: ids.length - fresh.length }),
      );
    });
    let accepted = 0;
    for (const head of ['a', 'b', 'a', 'b']) {
      const options = { configDir: t.configDir, fetch: t.fetch, git: fakeGit(head.repeat(40)) };
      accepted += (await runHook(t.input, options)).accepted;
    }
    expect(accepted).toBe(4);
    expect(readState(t.configDir, SESSION).gitSeq).toBe(4);
  });

  it('keeps the backlog when the API is down and sends it with the next Stop', async () => {
    const t = setup();
    writeFileSync(t.transcript, said(1));
    t.setReply(() => Promise.reject(new TypeError('fetch failed')));
    const log: string[] = [];
    const down = {
      configDir: t.configDir,
      fetch: t.fetch,
      git: noGit,
      log: (line: string) => log.push(line),
    };
    expect(await runHook(t.input, down)).toMatchObject({ status: 'stopped', pending: 1 });
    expect(readState(t.configDir, SESSION)).toEqual({ offset: 0 });
    expect(log).toEqual(['upload paused until the next Stop (fetch failed)']);
    t.setReply(() => Promise.resolve(new Response('', { status: 503 })));
    expect(await runHook(t.input, { ...down, log: () => undefined })).toMatchObject({
      status: 'stopped',
    });
    t.setReply(() => Promise.resolve(Response.json({ accepted: 1, duplicates: 0 })));
    expect(await runHook(t.input, down)).toMatchObject({ status: 'done', accepted: 1 });
    expect(t.posted).toHaveLength(3);
  });

  it('skips a batch the API refuses instead of retrying it forever', async () => {
    const t = setup();
    writeFileSync(t.transcript, said(1));
    t.setReply(() => Promise.resolve(new Response('', { status: 400 })));
    const log: string[] = [];
    const options = {
      configDir: t.configDir,
      fetch: t.fetch,
      git: noGit,
      log: (line: string) => log.push(line),
    };
    expect(await runHook(t.input, options)).toMatchObject({ status: 'done', accepted: 0 });
    expect(log).toEqual(['skipped 1 events the API refused']);
    expect(readState(t.configDir, SESSION).offset).toBe(said(1).length);
  });

  it('retries a refused batch line by line, so only the bad line is lost', async () => {
    const t = setup();
    writeFileSync(t.transcript, said(1) + said(2) + said(3));
    const bad = '00000000-0000-4000-8000-000000000002:0';
    t.setReply((ids) =>
      Promise.resolve(
        ids.includes(bad)
          ? new Response('', { status: 413 })
          : Response.json({ accepted: ids.length, duplicates: 0 }),
      ),
    );
    const log: string[] = [];
    const options = {
      configDir: t.configDir,
      fetch: t.fetch,
      git: noGit,
      log: (line: string) => log.push(line),
    };
    expect(await runHook(t.input, options)).toMatchObject({ status: 'done', accepted: 2 });
    expect(t.posted.map((ids) => ids.length)).toEqual([3, 1, 1, 1]);
    expect(log).toEqual(['skipped 1 events the API refused']);
    expect(readState(t.configDir, SESSION).offset).toBe((said(1) + said(2) + said(3)).length);
  });

  it('keeps posting when it cannot save progress, and runs git last within the budget', async () => {
    const t = setup();
    writeFileSync(t.transcript, said(1));
    chmodSync(t.configDir, 0o500);
    const log: string[] = [];
    const timeouts: number[] = [];
    const git: GitRunner = (args, cwd, timeoutMs) => {
      timeouts.push(timeoutMs);
      return fakeGit('c'.repeat(40))(args, cwd, timeoutMs);
    };
    let clock = 0;
    const options = {
      configDir: t.configDir,
      fetch: t.fetch,
      git,
      now: () => (clock += 100),
      budgetMs: 1000,
      log: (line: string) => log.push(line),
    };
    try {
      expect(await runHook(t.input, options)).toMatchObject({ status: 'done', accepted: 2 });
    } finally {
      chmodSync(t.configDir, 0o700);
    }
    expect(log).toHaveLength(1);
    expect(log[0]).toMatch(/^cannot save progress; it is resent with the next Stop/);
    expect(Math.max(...timeouts)).toBeLessThanOrEqual(400);
    clock = 0;
    timeouts.length = 0;
    await runHook(t.input, { ...options, now: () => (clock += 600), log: () => undefined });
    expect(timeouts).toEqual([]);
    expect(t.posted.at(-1)).toEqual(['00000000-0000-4000-8000-000000000001:0']);
  });

  it('stops at the deadline and leaves the rest for the next Stop', async () => {
    const t = setup();
    writeFileSync(t.transcript, said(1) + said(2));
    let clock = 0;
    t.setReply(() => {
      clock += 100;
      return Promise.resolve(Response.json({ accepted: 1, duplicates: 0 }));
    });
    const options = {
      configDir: t.configDir,
      fetch: t.fetch,
      git: noGit,
      now: () => clock,
      budgetMs: 100,
      maxBatchEvents: 1,
    };
    expect(await runHook(t.input, options)).toMatchObject({
      status: 'stopped',
      accepted: 1,
      pending: 1,
    });
    expect(readState(t.configDir, SESSION).offset).toBe(said(1).length);
  });

  it('uses the global fetch and logs to stderr by default', async () => {
    const t = setup();
    writeFileSync(t.transcript, said(1));
    vi.stubGlobal('fetch', () => Promise.reject(new Error('down')));
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      expect(await runHook(t.input, { configDir: t.configDir, git: noGit })).toMatchObject({
        status: 'stopped',
      });
      expect(stderr.mock.calls.map(([line]) => String(line))).toEqual([
        'debrief: upload paused until the next Stop (down)\n',
      ]);
    } finally {
      stderr.mockRestore();
      vi.unstubAllGlobals();
    }
  });

  it('does nothing before install or on input it does not understand', async () => {
    const t = setup();
    const empty = mkdtempSync(join(tmpdir(), 'debrief-hook-'));
    expect(await runHook(t.input, { configDir: empty, fetch: t.fetch })).toMatchObject({
      status: 'not-installed',
    });
    for (const input of [null, { ...t.input, session_id: '../etc' }, { ...t.input, cwd: '' }]) {
      expect(await runHook(input, { configDir: t.configDir, fetch: t.fetch })).toMatchObject({
        status: 'bad-input',
      });
    }
    expect(t.posted).toEqual([]);
  });
});

describe('transcriptBatches', () => {
  it('cuts batches on line boundaries by event count and size, keeping lines with no events', () => {
    const lines = [said(1), '{"type":"system"}\n', said(2), said(3)].map((text, n, all) => ({
      text: text.trimEnd(),
      end: all.slice(0, n + 1).join('').length,
    }));
    expect(transcriptBatches(lines, SESSION, 2, 1e9).map((b) => [b.events.length, b.end])).toEqual([
      [2, lines[2]!.end],
      [1, lines[3]!.end],
    ]);
    expect(transcriptBatches(lines, SESSION, 99, 10).map((b) => b.events.length)).toEqual([
      1, 1, 1,
    ]);
    const wide = [{ text: said(9).trimEnd().replace('step 9', 'é'.repeat(300)), end: 1 }];
    const [one] = transcriptBatches(wide, SESSION, 9, 1e9);
    const bytes = Buffer.byteLength(JSON.stringify(one!.events[0]));
    expect(bytes).toBeGreaterThan(JSON.stringify(one!.events[0]).length);
    expect(transcriptBatches([...wide, ...wide], SESSION, 9, bytes + 1)).toHaveLength(2);
    expect(transcriptBatches([], SESSION, 1, 1)).toEqual([]);
  });
});
