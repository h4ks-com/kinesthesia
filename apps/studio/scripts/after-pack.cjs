const { cpSync, existsSync } = require("node:fs");
const { join } = require("node:path");

// The builder's own copy step drops node_modules whatever pattern it is given,
// and the standalone server is nothing without them, so we place the folder
// ourselves once the bundle exists.
exports.default = async function afterPack(context) {
  const staged = join(__dirname, "..", "resources", "web");
  if (!existsSync(staged)) {
    throw new Error(`Nothing staged at ${staged}, run stage:web first`);
  }
  const resources =
    context.electronPlatformName === "darwin"
      ? join(
          context.appOutDir,
          `${context.packager.appInfo.productFilename}.app`,
          "Contents",
          "Resources",
        )
      : join(context.appOutDir, "resources");
  cpSync(staged, join(resources, "web"), { recursive: true });
};
