import { defineConfig } from "@playwright/test";
import base from "./playwright.config";

/** Frame timings, kept out of the test suite: these measure a machine rather
 * than assert behaviour, so a slow runner would fail them for the wrong reason.
 * Chromium only, and headless, where frames are not held to the display's
 * refresh: under vsync every reading pins to 16.7ms and the work is invisible. */
export default defineConfig({
  ...base,
  testDir: "./bench",
  reporter: "list",
  retries: 0,
  workers: 1,
  projects: [
    {
      name: "bench",
      use: {
        ...base.projects?.[0]?.use,
        viewport: { width: 1280, height: 720 },
      },
    },
  ],
});
