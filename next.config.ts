import type { NextConfig } from 'next';

const isExport = process.env.NEXT_OUTPUT === 'export';

const nextConfig: NextConfig = {
  output: isExport ? 'export' : 'standalone',
  reactStrictMode: false,
  allowedDevOrigins: [
    '*.space-z.ai',
  ],
  // Proxy all /api/* requests to the standalone Fastify API service
  // (not applicable when building static export for Tauri)
  ...(!isExport
    ? {
        async rewrites() {
          return [
            {
              source: '/api/:path*',
              destination: 'http://127.0.0.1:3001/api/:path*',
            },
          ];
        },
      }
    : {}),
};

export default nextConfig;
