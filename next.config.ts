import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  output: 'standalone',

  images: {
    unoptimized: true,
  },

  serverExternalPackages: ['better-sqlite3'],

  turbopack: {},

  experimental: {
    serverActions: {
      bodySizeLimit: '2mb',
    },
  },
};

export default nextConfig;
