import type { NextConfig } from 'next';

const config: NextConfig = {
  reactStrictMode: true,
  transpilePackages: [
    '@debrief/schema',
    '@debrief/ui',
    '@debrief/reconstruct',
    '@debrief/policy',
    '@debrief/evidence',
    '@debrief/chain',
  ],
  // The landing is the static public/index.html (scripts/render-landing.ts): no runtime to download on 3G.
  rewrites: () => Promise.resolve({ beforeFiles: [{ source: '/', destination: '/index.html' }] }),
  // The demo bundle is fetched by the verifier from another origin (or file://); the video and poster ride along.
  headers: () =>
    Promise.resolve([
      {
        source: '/demo/:path*',
        headers: [
          { key: 'access-control-allow-origin', value: '*' },
          { key: 'cache-control', value: 'public, max-age=3600' },
        ],
      },
    ]),
  webpack: (webpackConfig: { resolve: { extensionAlias?: Record<string, string[]> } }) => {
    webpackConfig.resolve.extensionAlias = { '.js': ['.ts', '.tsx', '.js'] };
    return webpackConfig;
  },
};

export default config;
