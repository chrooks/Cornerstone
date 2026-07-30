/** @type {import('next').NextConfig} */
const nextConfig = {
  // Opt-in build-dir isolation so concurrent `next dev` instances (parallel
  // agent sessions) don't corrupt each other's shared .next cache.
  distDir: process.env.NEXT_DIST_DIR || '.next',
  allowedDevOrigins: ['100.69.82.20', '192.168.1.156'],
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'ak-static.cms.nba.com',
        pathname: '/wp-content/uploads/headshots/**',
      },
    ],
  },
};

export default nextConfig;
