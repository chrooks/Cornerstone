/** @type {import('next').NextConfig} */
const nextConfig = {
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
