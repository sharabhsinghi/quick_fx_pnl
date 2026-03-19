/** @type {import('next').NextConfig} */
const REPO = '/quick_fx_pnl';

const nextConfig = {
  reactStrictMode: true,
  output: 'export',
  basePath: REPO,
  images: { unoptimized: true },
  // Expose basePath to client-side code so fetch calls can be prefixed correctly
  env: {
    NEXT_PUBLIC_BASE_PATH: REPO,
  },
};

module.exports = nextConfig;
