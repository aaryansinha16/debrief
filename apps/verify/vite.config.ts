import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// One HTML file with everything inlined: a module script with a src is blocked on file://, an inline one is not (NFR-6).
export default defineConfig({
  base: './',
  plugins: [viteSingleFile()],
  build: { target: 'es2022', outDir: 'dist', emptyOutDir: true },
});
