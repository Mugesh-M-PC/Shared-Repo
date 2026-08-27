require('dotenv').config();
const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests',
  timeout: 30_000,
  use: {
    baseURL: 'http://localhost:8000',
    headless: false,
    // viewport: { width: 1280, height: 720 },
    screenshot: 'only-on-failure',
    // trace: 'on-first-retry',
    trace: 'on',
    video: 'retain-on-failure',
    // video: 'on',
    launchOptions: {
      // slowMo: 500,
    },
  },
  reporter: [
    ['list'],
    ['html', {
      open: 'never',
      outputFolder: 'playwright-report'
    }],
  ],
});

