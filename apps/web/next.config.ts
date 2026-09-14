import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";
import { countryTableFile } from "./src/lib/analytics-report";

const nextConfig: NextConfig = {
  output: "standalone",
  /** The keybed runtime is TypeScript source, published straight from its own
   * repo so its browser code and its python twin stay in step. */
  transpilePackages: ["keybed"],
  /** Bun hoists the workspace's modules to the repo root, so tracing has to
   * start there or the standalone build ships without them. */
  outputFileTracingRoot: join(dirname(fileURLToPath(import.meta.url)), "../.."),
  /** The address table analytics reads is a database, not a module, so it is
   * opened by path at runtime and nothing traces it here. Named so the standalone
   * output carries it, at the path `analytics/track.ts` opens. */
  outputFileTracingIncludes: {
    "/**/*": [`./${countryTableFile}`],
  },
  async redirects() {
    return [
      { source: "/docs", destination: "/api/docs", permanent: false },
      {
        source: "/openapi.json",
        destination: "/api/openapi.json",
        permanent: false,
      },
    ];
  },
};

export default nextConfig;
