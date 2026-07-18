import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
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
