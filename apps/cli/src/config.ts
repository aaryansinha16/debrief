import { chmodSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { z } from 'zod';

export const configSchema = z.strictObject({
  apiUrl: z.url({ protocol: /^https?$/ }),
  key: z.string().regex(/^dbf_[A-Za-z0-9_-]{43}$/),
  keyId: z.string().min(1),
});

export type CliConfig = z.infer<typeof configSchema>;

export const configFile = (dir: string): string => join(dir, 'config.json');

export function ensurePrivateDir(dir: string): void {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  chmodSync(dir, 0o700);
}

// The key lives only here, mode 600, never in Claude Code's settings (ARCHITECTURE §18.2).
export function writePrivateFile(file: string, text: string): void {
  const temp = `${file}.${String(process.pid)}.tmp`;
  writeFileSync(temp, text, { mode: 0o600 });
  chmodSync(temp, 0o600);
  renameSync(temp, file);
}

export function readConfig(dir: string): CliConfig | undefined {
  try {
    const parsed = configSchema.safeParse(JSON.parse(readFileSync(configFile(dir), 'utf8')));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

export function writeConfig(dir: string, config: CliConfig): void {
  ensurePrivateDir(dir);
  writePrivateFile(configFile(dir), `${JSON.stringify(configSchema.parse(config), null, 2)}\n`);
}

export function removeConfig(dir: string): void {
  rmSync(configFile(dir), { force: true });
}
