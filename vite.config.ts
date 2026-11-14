import { resolve } from 'node:path';
import { configDefaults, defineConfig } from 'vitest/config';
import { SITE_URL } from './src/config';

/**
 * The proof pages (debug.html: the route proof; tileproof.html and world.html: the 3D look;
 * lmview.html: one landmark model alone; personview.html: the person and the release) are for checking, not for visitors. `npm run dev` serves them as always. A build includes them only for a
 * preview branch (the deploy workflow sets BRANCH; `main` is the live site) or with DEBUG_PAGES=1
 * (the browser tests, which use tileproof.html).
 */
const branch = process.env.BRANCH;
const proofPages = process.env.DEBUG_PAGES === '1' || (!!branch && branch !== 'main');
const page = (name: string) => resolve(__dirname, `${name}.html`);

export default defineConfig({
  // the share tags in index.html name the live address, which is set once, in src/config.ts
  plugins: [{ name: 'site-url', transformIndexHtml: (html: string) => html.replaceAll('%SITE_URL%', SITE_URL) }],
  // test-only switches in the page (window.__lgoabStreaks, ?backdrop=) are read in a test or preview build
  // only: the live site's build leaves the code out
  define: { __LGOAB_TEST_HOOKS__: JSON.stringify(proofPages) },
  // e2e/ holds the Playwright browser tests (npm run e2e)
  test: { exclude: [...configDefaults.exclude, 'e2e/**', '.claude/**'] },
  build: {
    outDir: 'dist',
    target: 'es2022',
    rollupOptions: {
      input: proofPages ? { main: page('index'), debug: page('debug'), tileproof: page('tileproof'), world: page('world'), lmview: page('lmview'), personview: page('personview') } : { main: page('index') },
    },
  },
});
