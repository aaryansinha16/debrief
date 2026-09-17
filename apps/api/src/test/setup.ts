import { existsSync } from 'node:fs';

const envFile = new URL('../../../../.env', import.meta.url);
if (existsSync(envFile)) process.loadEnvFile(envFile);
process.env.LOG_LEVEL = 'silent';
