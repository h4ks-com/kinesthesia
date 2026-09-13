import { cp, mkdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** The standalone server carries its own modules but not what the browser asks
 * for, so the static files and the public folder are laid beside it. Studio
 * ships the result as one folder and runs it from there. */
const studio = join(dirname(fileURLToPath(import.meta.url)), "..");
const web = join(studio, "..", "web");
const staged = join(studio, "resources", "web");

await rm(staged, { recursive: true, force: true });
await mkdir(dirname(staged), { recursive: true });
await cp(join(web, ".next", "standalone"), staged, { recursive: true });
await cp(
  join(web, ".next", "static"),
  join(staged, "apps", "web", ".next", "static"),
  { recursive: true },
);
await cp(join(web, "public"), join(staged, "apps", "web", "public"), {
  recursive: true,
});
await cp(join(web, "drizzle"), join(staged, "apps", "web", "drizzle"), {
  recursive: true,
});
console.log(`Staged the web app at ${staged}`);
