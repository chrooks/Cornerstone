/** @type {import('next').NextConfig} */
const nextConfig = {
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
