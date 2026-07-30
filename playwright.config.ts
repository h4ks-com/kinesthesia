import { defineConfig, devices } from "@playwright/test";

const isCi = process.env.CI !== undefined;
const port = 3210;
const baseURL = `http://localhost:${port}`;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: isCi,
  retries: isCi ? 1 : 0,
  // The github reporter annotates the run but writes nothing to disk, so a
  // failure there left no trace to read afterwards.
  reporter: isCi ? [["github"], ["html", { open: "never" }]] : "list",
  use: { baseURL, trace: "on-first-retry" },
  // Firefox carries a different Web Audio and WebCodecs surface from Chrome's,
  // and a browser nothing runs against is a browser nothing catches.
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    {
      name: "firefox",
      use: {
        ...devices["Desktop Firefox"],
        // A runner has no GPU, and Firefox refuses WebGL there unless told the
        // software path is acceptable. Without it every shader background is
        // correctly reported unsupported and none of them can be exercised.
        launchOptions: {
          firefoxUserPrefs: {
            "webgl.force-enabled": true,
            "webgl.disable-fail-if-major-performance-caveat": true,
            "gfx.webrender.software": true,
          },
        },
      },
      // Firefox is here for what differs between engines: Web Audio, WebCodecs,
      // pointer capture, storage. Reading lit pixels back off a canvas that is
      // still animating measures the rasteriser and the frame clock, which are
      // meant to differ, so those specs stay on one engine.
      testIgnore: [/bend\.spec\.ts/],
    },
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
