import { resolve } from 'node:path';
import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  // e2e/ holds the Playwright browser tests (npm run e2e)
  test: { exclude: [...configDefaults.exclude, 'e2e/**'] },
  build: {
    outDir: 'dist',
    target: 'es2022',
    rollupOptions: {
      input: { main: resolve(__dirname, 'index.html'), debug: resolve(__dirname, 'debug.html'), tileproof: resolve(__dirname, 'tileproof.html') },
    },
  },
});
