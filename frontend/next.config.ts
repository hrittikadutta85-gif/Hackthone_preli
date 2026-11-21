import type { NextConfig } from "next";

// The browser only ever talks to Next.js; /api/* is proxied to the FastAPI backend (no CORS, one origin).
const API = process.env.API_URL ?? "http://127.0.0.1:8000";

const nextConfig: NextConfig = {
  turbopack: {
    rules: {
      "*.css": { loaders: ["@tailwindcss/turbopack"], as: "*.css" },
    },
  },
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${API}/api/:path*` }];
  },
};

export default nextConfig;
