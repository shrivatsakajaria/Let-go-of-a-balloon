import { resolve } from 'node:path';
import { configDefaults, defineConfig } from 'vitest/config';

/**
 * The proof pages (debug.html: the route proof; tileproof.html and world.html: the 3D look;
 * lmview.html: one landmark model alone) are for checking, not for visitors. `npm run dev` serves them as always. A build includes them only for a
 * preview branch (the deploy workflow sets BRANCH; `main` is the live site) or with DEBUG_PAGES=1
 * (the browser tests, which use tileproof.html).
 */
const branch = process.env.BRANCH;
const proofPages = process.env.DEBUG_PAGES === '1' || (!!branch && branch !== 'main');
const page = (name: string) => resolve(__dirname, `${name}.html`);

export default defineConfig({
  // e2e/ holds the Playwright browser tests (npm run e2e)
  test: { exclude: [...configDefaults.exclude, 'e2e/**', '.claude/**'] },
  build: {
    outDir: 'dist',
    target: 'es2022',
    rollupOptions: {
      input: proofPages ? { main: page('index'), debug: page('debug'), tileproof: page('tileproof'), world: page('world'), lmview: page('lmview') } : { main: page('index') },
    },
  },
});
