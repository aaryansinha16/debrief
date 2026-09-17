import { config } from '@debrief/config/eslint';
import { defineConfig } from 'eslint/config';

export default defineConfig({ ignores: ['next-env.d.ts', '*.config.mjs'] }, config, {
  files: ['src/app/**/page.tsx', 'src/app/**/layout.tsx', 'src/app/**/not-found.tsx'],
  rules: { 'no-restricted-syntax': 'off' },
});
