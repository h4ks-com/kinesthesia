import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

/** Electron ships its runtime through an install step that Bun leaves alone, so
 * we run it ourselves before anything needs the binary. */
const packageDirectory = dirname(
  createRequire(import.meta.url).resolve("electron/package.json"),
);

if (existsSync(join(packageDirectory, "dist"))) {
  process.exit(0);
}

console.log("Fetching the Electron runtime");
const run = spawnSync("bun", [join(packageDirectory, "install.js")], {
  stdio: "inherit",
});
process.exit(run.status ?? 1);
