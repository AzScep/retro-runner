import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: true,
  retries: 0,
  use: { baseURL: 'http://localhost:4173', trace: 'retain-on-failure' },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
    // Touch (design 17, research-mobile 6): landscape phones, touch specs only. Service workers are
    // blocked so a precache can never serve a stale build (test builds do not register one anyway).
    {
      name: 'mobile-chromium',
      testMatch: /touch\.spec\.ts/,
      use: { ...devices['Pixel 7 landscape'], serviceWorkers: 'block' },
    },
    {
      name: 'mobile-webkit',
      testMatch: /touch\.spec\.ts/,
      use: { ...devices['iPhone 15 landscape'], serviceWorkers: 'block' },
    },
  ],
  webServer: {
    command: 'npx vite build && npx vite preview --port 4173 --strictPort',
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env['CI'],
    env: { VITE_TEST_HOOKS: '1' },
    timeout: 120_000,
  },
});
