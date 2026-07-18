import { defineConfig, devices } from "@playwright/test";

const isCi = process.env.CI !== undefined;
const port = 3210;
const baseURL = `http://localhost:${port}`;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: isCi,
  retries: isCi ? 1 : 0,
  reporter: isCi ? "github" : "list",
  use: { baseURL, trace: "on-first-retry" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `bun run build && PORT=${port} APP_BASE_URL=${baseURL} bun run start`,
    url: baseURL,
    reuseExistingServer: !isCi,
    timeout: 180_000,
  },
});
