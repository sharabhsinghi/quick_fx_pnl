/** @type {import('next').NextConfig} */
const REPO = '/quick_fx_pnl';
const isProd = process.env.NODE_ENV === 'production';

const nextConfig = {
  reactStrictMode: true,
  output: 'export',
  basePath: isProd ? REPO : '',
  images: { unoptimized: true },
  // Expose basePath to client so fetch calls in priceService.js can be prefixed correctly
  env: {
    NEXT_PUBLIC_BASE_PATH: isProd ? REPO : '',
  },
};

module.exports = nextConfig;
