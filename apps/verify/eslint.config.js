import { config } from '@debrief/config/eslint';
import { defineConfig } from 'eslint/config';

export default defineConfig({ ignores: ['dist'] }, config);
