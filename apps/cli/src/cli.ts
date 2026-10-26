import { realpathSync } from 'node:fs';
import { hostname } from 'node:os';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import { runHook } from './hook.js';
import { InstallError, install, uninstall } from './install.js';
import { claudeSettingsFile, debriefConfigDir } from './paths.js';
import { SettingsError, hookCommand } from './settings.js';

const USAGE = [
  'usage: debrief claude-code <install | uninstall | hook> [--config <dir>]',
  '  install    add the Stop hook to Claude Code user settings (--api <url> --key <dbf_…>)',
  '  uninstall  remove the hook and restore the settings it changed',
  '  hook       what the hook runs: posts new transcript lines and the git state',
  'env: DEBRIEF_API_URL (default http://localhost:4000), DEBRIEF_API_KEY, CLAUDE_CONFIG_DIR',
  '',
].join('\n');

const say = (line: string): void => {
  process.stderr.write(`${line}\n`);
};

async function readStdin(limit: number, ms: number): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  const done = new Promise<void>((resolve) => {
    process.stdin.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size <= limit) chunks.push(chunk);
    });
    process.stdin.on('end', resolve);
    process.stdin.on('error', () => {
      resolve();
    });
    setTimeout(resolve, ms).unref();
  });
  await done;
  return Buffer.concat(chunks).toString('utf8');
}

const [group, command, ...rest] = process.argv.slice(2);
const parsed = parseArgs({
  args: rest,
  options: { api: { type: 'string' }, key: { type: 'string' }, config: { type: 'string' } },
  strict: false,
});
const option = (name: string): string | undefined => {
  const value = parsed.values[name];
  return typeof value === 'string' && value !== '' ? value : undefined;
};
const configDir = option('config') ?? debriefConfigDir();
const settingsFile = claudeSettingsFile();

if (group !== 'claude-code') {
  say(USAGE);
  process.exitCode = 2;
} else if (command === 'hook') {
  let input: unknown;
  try {
    input = JSON.parse(await readStdin(1024 * 1024, 500));
  } catch {
    input = undefined;
  }
  try {
    await runHook(input, { configDir });
  } catch (error) {
    say(`debrief: hook stopped (${error instanceof Error ? error.message : 'error'})`);
  }
  // Exit now: an open stdin or a keep-alive socket must not hold the turn past the deadline.
  process.exit(0);
} else if (command === 'install') {
  const bin = realpathSync(fileURLToPath(new URL('../bin/debrief.js', import.meta.url)));
  try {
    const report = await install({
      apiUrl: option('api') ?? process.env.DEBRIEF_API_URL ?? 'http://localhost:4000',
      ...((option('key') ?? process.env.DEBRIEF_API_KEY)
        ? { key: option('key') ?? process.env.DEBRIEF_API_KEY }
        : {}),
      configDir,
      settingsFile,
      command: hookCommand(process.execPath, bin, configDir),
      host: hostname(),
    });
    const how = report.issued ? 'a local key issued for this machine' : 'the local key you gave';
    say(`installed the Claude Code hook in ${settingsFile}, posting with ${how} (${report.keyId})`);
  } catch (error) {
    if (!(error instanceof InstallError || error instanceof SettingsError)) throw error;
    say(`debrief: ${error.message}`);
    process.exitCode = 1;
  }
} else if (command === 'uninstall') {
  const report = uninstall({ configDir, settingsFile });
  const what = {
    restored: 'restored the settings as they were',
    removed: 'removed the hook and kept your other changes',
    absent: 'found no hook to remove',
  }[report.settings];
  say(`${what} in ${settingsFile}`);
  if (report.keyId !== undefined)
    say(`key ${report.keyId} still works until you revoke it: DELETE /v1/keys/${report.keyId}`);
} else {
  say(USAGE);
  process.exitCode = 2;
}
