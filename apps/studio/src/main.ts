import { join } from "node:path";
import { app, BrowserWindow } from "electron";
import { type LocalServer, startLocalServer } from "./server";

let server: LocalServer | null = null;

/** The standalone build of the web app, packaged beside studio or, while
 * developing, left where `bun run build` writes it. */
function serverEntry(): string {
  return app.isPackaged
    ? join(process.resourcesPath, "web", "apps", "web", "server.js")
    : join(
        __dirname,
        "..",
        "..",
        "web",
        ".next",
        "standalone",
        "apps",
        "web",
        "server.js",
      );
}

async function open(): Promise<void> {
  server = await startLocalServer(serverEntry());
  const window = new BrowserWindow({
    width: 1400,
    height: 900,
    backgroundColor: "#07080b",
    title: "Kinesthesia Studio",
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });
  await window.loadURL(server.url);
}

app.whenReady().then(open);

app.on("window-all-closed", () => {
  server?.stop();
  server = null;
  app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    void open();
  }
});
