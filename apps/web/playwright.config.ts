import { defineConfig, devices } from "@playwright/test";

const isCi = process.env.CI !== undefined;
const port = 3210;
const baseURL = `http://localhost:${port}`;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: isCi,
  retries: isCi ? 1 : 0,
  // A background runs its shader in a worker and is switched off when the frame
  // clock starves, so oversubscribing the machine reads as a device that cannot
  // run one. Three pages at once costs no wall clock here and leaves the
  // machine usable.
  workers: isCi ? 2 : 3,
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
        // software path is acceptable. Enough for a canvas on the page, which
        // is what the picture backgrounds draw on.
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
      //
      // A background draws its shader in a worker, onto an OffscreenCanvas.
      // Firefox gives that path to its GPU process, and a runner has no GPU
      // process to give it to, so there it reports no WebGL2 and every shader
      // background is correctly dark. Neither the software renderer nor asking
      // for WebGL in process reaches it. The specs that read those pixels run
      // on one engine; every spec that asks what Firefox itself does with a
      // background, the sandbox and the worker protocol among them, still runs
      // on both.
      testIgnore: [
        /bend\.spec\.ts/,
        /skin-previews\.spec\.ts/,
        /skins-run-as-scripts\.spec\.ts/,
        /background-doc\.spec\.ts/,
        /flower\.spec\.ts/,
      ],
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
