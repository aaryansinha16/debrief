import { z } from 'zod';

// Read on the server only; the API key never reaches the browser.
const envSchema = z.object({
  DEBRIEF_API_URL: z.url().default('http://localhost:4000'),
  DEBRIEF_API_KEY: z.string().min(1).optional(),
});

export type WebEnv = z.infer<typeof envSchema>;

export function readEnv(source: Record<string, string | undefined> = process.env): WebEnv {
  return envSchema.parse({
    DEBRIEF_API_URL: source.DEBRIEF_API_URL === '' ? undefined : source.DEBRIEF_API_URL,
    DEBRIEF_API_KEY: source.DEBRIEF_API_KEY === '' ? undefined : source.DEBRIEF_API_KEY,
  });
}
