import type { NextConfig } from "next";
import { countryTableFile } from "./src/lib/analytics-report";

const nextConfig: NextConfig = {
  output: "standalone",
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
