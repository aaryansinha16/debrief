import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [
    swc.vite({
      jsc: { transform: { legacyDecorator: true, decoratorMetadata: true }, target: 'es2022' },
      module: { type: 'es6' },
    }),
  ],
  test: {
    environment: 'node',
    setupFiles: ['./src/test/setup.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: [
        'src/**/*.test.ts',
        'src/test/**',
        'src/main.ts',
        'src/index.ts',
        'src/keygen.ts',
        'src/seed.ts',
        'src/db/migrate-cli.ts',
        'src/db/schema.ts',
      ],
      thresholds: { lines: 90, branches: 85, functions: 90, statements: 90 },
    },
  },
});
