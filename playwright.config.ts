import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end tests. Require, on this machine: Docker running, `npm run db:start`,
 * `npm run db:reset`, `npm run env:local`, `npm run seed:local`.
 * Uses only SYNTHETIC seeded users and the local test inbox (Mailpit).
 */
export default defineConfig({
  testDir: "e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: "list",
  use: {
    baseURL: "http://localhost:3000",
    trace: "retain-on-failure",
    // Optional override for machines with a preinstalled browser; unset on your Mac.
    launchOptions: process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {},
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "npm run dev",
    url: "http://localhost:3000/login",
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
