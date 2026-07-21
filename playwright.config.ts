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
    // The fixtures play a file from example.test, so that origin is trusted for
    // the run, exercising the same allowlist the app ships with.
    command: `NEXT_PUBLIC_MIDI_TRUSTED_ORIGINS=https://example.test bun run build && PORT=${port} APP_BASE_URL=${baseURL} NEXT_PUBLIC_MIDI_TRUSTED_ORIGINS=https://example.test bun run start`,
    url: baseURL,
    reuseExistingServer: !isCi,
    timeout: 180_000,
  },
});
