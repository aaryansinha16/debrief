import { z } from 'zod';

export const configSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_HOST: z.string().min(1).default('0.0.0.0'),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  DATABASE_URL: z.string().regex(/^postgres(ql)?:\/\//, 'must be a postgres:// url'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
});

export type Config = z.infer<typeof configSchema>;

export const CONFIG = Symbol('CONFIG');

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  return configSchema.parse(env);
}
