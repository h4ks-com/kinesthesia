import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** The packaged app, wherever the builder left it for this system. */
function packagedApp(): string {
  const release = join(
    dirname(fileURLToPath(import.meta.url)),
    "..",
    "release",
  );
  const candidates: Record<string, string> = {
    darwin: join(
      release,
      "mac-arm64",
      "Kinesthesia Studio.app",
      "Contents",
      "MacOS",
      "Kinesthesia Studio",
    ),
    win32: join(release, "win-unpacked", "Kinesthesia Studio.exe"),
    linux: join(release, "linux-unpacked", "kinesthesia-studio"),
  };
  const found = candidates[process.platform];
  if (found === undefined || !existsSync(found)) {
    throw new Error(`No packaged app for ${process.platform} at ${found}`);
  }
  return found;
}

/** The page the window holds, once it holds one of ours. */
async function servedPage(
  port: number,
  until: number,
): Promise<{ title: string; url: string } | null> {
  while (Date.now() < until) {
    try {
      const pages = (await (
        await fetch(`http://127.0.0.1:${port}/json`)
      ).json()) as { type: string; title: string; url: string }[];
      const page = pages.find(
        (entry) =>
          entry.type === "page" && entry.url.startsWith("http://127.0.0.1"),
      );
      if (page !== undefined) {
        return { title: page.title, url: page.url };
      }
    } catch {
      // The app is still starting, so there is nothing to read yet.
    }
    await new Promise((wake) => setTimeout(wake, 500));
  }
  return null;
}

const port = 9339;
// A runner has no GPU and, on Linux, no user namespace for the sandbox.
const app = spawn(
  packagedApp(),
  [`--remote-debugging-port=${port}`, "--no-sandbox", "--disable-gpu"],
  { stdio: "inherit" },
);
const page = await servedPage(port, Date.now() + 90_000);
if (page === null) {
  app.kill();
  console.error("The packaged app opened no window on its own server");
  process.exit(1);
}

// A window alone proves little, since a browser shows an error page the same
// way, so the page itself has to be the app.
const body = await (await fetch(page.url)).text();
app.kill();
if (!body.includes("Kinesthesia")) {
  console.error(
    `The packaged app served something else at ${page.url}, titled "${page.title}":`,
  );
  console.error(body.slice(0, 400));
  process.exit(1);
}
console.log(`The packaged app served ${page.title} at ${page.url}`);
