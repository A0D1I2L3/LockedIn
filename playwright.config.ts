import fs from "node:fs";
import path from "node:path";
import { defineConfig } from "@playwright/test";

const port = 3100;
const baseURL = `http://127.0.0.1:${port}`;
const chromium =
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ||
  (fs.existsSync("/usr/bin/chromium") ? "/usr/bin/chromium" : "");

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 30_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL,
    trace: "retain-on-failure",
    ...(chromium ? { launchOptions: { executablePath: chromium } } : {}),
  },
  webServer: {
    command: "node tests/e2e/seed.mjs && npm run start -- -p " + port,
    url: `${baseURL}/api/health`,
    timeout: 60_000,
    reuseExistingServer: false,
    env: {
      DATA_DIR: path.resolve(".e2e-data"),
      SECRET_KEY: "e2e-test-secret",
      BASE_URL: baseURL,
      LLM_PROVIDER: "openai",
    },
  },
});
