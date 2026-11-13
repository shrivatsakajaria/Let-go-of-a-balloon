import { defineConfig, devices } from '@playwright/test';

/**
 * Browser tests against the production build. They never call live services: every request
 * outside the local preview server is answered from tests/fixtures or blocked (see e2e/net.ts).
 * E2E_PORT moves the preview server (two checkouts testing at once must not share one).
 */
const port = Number(process.env.E2E_PORT ?? 4173);

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: true,
  reporter: 'list',
  timeout: 30_000,
  use: {
    baseURL: `http://localhost:${port}`,
    viewport: { width: 390, height: 844 },
    trace: 'off',
    serviceWorkers: 'block',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 390, height: 844 } } }],
  webServer: {
    command: `npm run build && npx vite preview --port ${port} --strictPort`,
    url: `http://localhost:${port}`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    // the sky checks use the tile proof page, which the live site's build leaves out
    env: { DEBUG_PAGES: '1' },
  },
});
