import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // node:sqlite and child_process are used by the Vision backend only (server side).
  serverExternalPackages: [],
  eslint: {
    // Linting runs as its own verification step (`npm run lint`), not inside `next build`.
    ignoreDuringBuilds: true,
  },
  experimental: {
    // Monaco ships large ESM chunks; keep them out of the server bundle graph.
    optimizePackageImports: ['lucide-react'],
  },
};

export default nextConfig;
