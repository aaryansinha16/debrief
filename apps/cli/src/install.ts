import { issueLocalKey, whoAmI } from './api.js';
import { type CliConfig, readConfig, removeConfig, writeConfig } from './config.js';
import { type UninstallOutcome, installHook, uninstallHook } from './settings.js';

export class InstallError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InstallError';
  }
}

export interface InstallOptions {
  apiUrl: string;
  key?: string;
  configDir: string;
  settingsFile: string;
  command: string;
  host: string;
  fetch?: typeof fetch;
}

export interface InstallReport {
  keyId: string;
  issued: boolean;
}

// D-084: the stored key is always local; a third-party key only issues one and is never written down.
export async function install(options: InstallOptions): Promise<InstallReport> {
  const existing = readConfig(options.configDir);
  const key = options.key ?? (existing?.apiUrl === options.apiUrl ? existing.key : undefined);
  if (key === undefined) throw new InstallError('pass --key <dbf_…> or set DEBRIEF_API_KEY');
  const api = { apiUrl: options.apiUrl, key, ...(options.fetch ? { fetch: options.fetch } : {}) };
  let config: CliConfig;
  try {
    const me = await whoAmI(api);
    if (me.trust === 'local') config = { apiUrl: options.apiUrl, key, keyId: me.keyId };
    else {
      const issued = await issueLocalKey(api, `claude-code@${options.host}`);
      config = { apiUrl: options.apiUrl, key: issued.key, keyId: issued.id };
    }
  } catch (error) {
    throw new InstallError(`the API refused the key (${(error as Error).message})`);
  }
  writeConfig(options.configDir, config);
  installHook(options.settingsFile, options.configDir, options.command);
  return { keyId: config.keyId, issued: config.key !== key };
}

export interface UninstallReport {
  settings: UninstallOutcome;
  keyId?: string;
}

export function uninstall(options: { configDir: string; settingsFile: string }): UninstallReport {
  const keyId = readConfig(options.configDir)?.keyId;
  const settings = uninstallHook(options.settingsFile, options.configDir);
  removeConfig(options.configDir);
  return keyId === undefined ? { settings } : { settings, keyId };
}
