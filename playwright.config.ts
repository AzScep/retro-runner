import { defineConfig, devices } from '@playwright/test';

// A running server on this port is reused, so worktrees testing in parallel each need their own:
// E2E_PORT=4191 npx playwright test.
const port = Number(process.env['E2E_PORT'] ?? 4173);

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: true,
  retries: 0,
  use: { baseURL: `http://localhost:${port}`, trace: 'retain-on-failure' },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'], launchOptions: { args: ['--mute-audio'] } } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
    // Touch (design 17, research-mobile 6): landscape phones, touch specs only. Service workers are
    // blocked so a precache can never serve a stale build (test builds do not register one anyway).
    {
      name: 'mobile-chromium',
      testMatch: /touch\.spec\.ts/,
      use: {
        ...devices['Pixel 7 landscape'],
        serviceWorkers: 'block',
        launchOptions: { args: ['--mute-audio'] },
      },
    },
    {
      name: 'mobile-webkit',
      testMatch: /touch\.spec\.ts/,
      use: { ...devices['iPhone 15 landscape'], serviceWorkers: 'block' },
    },
  ],
  webServer: {
    command: `npx vite build && npx vite preview --port ${port} --strictPort`,
    url: `http://localhost:${port}`,
    reuseExistingServer: !process.env['CI'],
    env: { VITE_TEST_HOOKS: '1' },
    timeout: 120_000,
  },
});
