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
  // Firefox carries a different Web Audio and WebCodecs surface from Chrome's,
  // and a browser nothing runs against is a browser nothing catches.
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "firefox", use: { ...devices["Desktop Firefox"] } },
  ],
  webServer: {
    // The fixtures play a file from example.test, so that origin is trusted for
    // the run, exercising the same allowlist the app ships with. The object
    // store settings only have to be present: sharing is offered when one is
    // configured, and no test reaches the upload itself. Runtime env, so only
    // start needs it.
    command: `bun run build && PORT=${port} APP_BASE_URL=${baseURL} MIDI_TRUSTED_ORIGINS=https://example.test MINIO_ENDPOINT=files.test MINIO_ACCESS_KEY=test MINIO_SECRET_KEY=test MINIO_BUCKET=test MINIO_PUBLIC_BASE=https://files.test bun run start`,
    url: baseURL,
    reuseExistingServer: !isCi,
    timeout: 180_000,
  },
});
