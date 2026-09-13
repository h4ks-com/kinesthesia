import { createServer } from "node:net";
import { app, type UtilityProcess, utilityProcess } from "electron";

export type LocalServer = {
  readonly url: string;
  readonly stop: () => void;
};

/** The port is taken from the system rather than fixed, so a studio window never
 * lands on another program's server or on a second studio. */
function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.on("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      if (address === null || typeof address === "string") {
        probe.close();
        reject(new Error("The system named no port for the local server"));
        return;
      }
      const { port } = address;
      probe.close(() => resolve(port));
    });
  });
}

async function answers(url: string, until: number): Promise<boolean> {
  while (Date.now() < until) {
    try {
      await fetch(url, { method: "HEAD" });
      return true;
    } catch {
      await new Promise((wake) => setTimeout(wake, 100));
    }
  }
  return false;
}

/** Kinesthesia itself, served from this machine. Studio never reaches for a
 * hosted copy, so everything it does works with no network. */
export async function startLocalServer(entry: string): Promise<LocalServer> {
  const port = await freePort();
  const url = `http://127.0.0.1:${port}`;
  const child: UtilityProcess = utilityProcess.fork(entry, [], {
    cwd: app.getPath("userData"),
    env: {
      ...process.env,
      PORT: `${port}`,
      HOSTNAME: "127.0.0.1",
      NODE_ENV: "production",
    },
    stdio: "inherit",
  });
  if (!(await answers(url, Date.now() + 30_000))) {
    child.kill();
    throw new Error(`The local server did not answer at ${url}`);
  }
  return { url, stop: () => child.kill() };
}
