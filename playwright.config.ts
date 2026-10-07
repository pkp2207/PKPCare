import { defineConfig, devices } from "@playwright/test";

// Browser end-to-end tests against a REAL Appwrite project (the one in .env).
//   npm run test:e2e        (non-production projects only; creates and deletes a test patient)
//
// The app under test is a production build in its own folder (.next-e2e) on port 3100,
// so it never touches a running `npm run dev` (port 3000, .next). Notifications are
// disabled so fake patients never receive real messages.
try {
  process.loadEnvFile(".env");
} catch {
  // .env missing: the webServer and support helpers will fail with a clear message.
}

const PORT = 3100;

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]],
  outputDir: "test-results",
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `npx next build && npx next start -p ${PORT}`,
    url: `http://localhost:${PORT}/privacy`,
    timeout: 300_000,
    reuseExistingServer: true,
    stdout: "ignore",
    stderr: "pipe",
    env: {
      NEXT_DIST_DIR: ".next-e2e",
      NOTIFICATIONS_DISABLED: "true",
      PATIENT_AUTH_ENFORCED: "false",
      ALLOW_LEGACY_ADMIN_PASSKEY: "false",
      APP_BASE_URL: `http://localhost:${PORT}`,
    },
  },
});
