import type { NextConfig } from 'next';

const config: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@debrief/schema', '@debrief/ui'],
  webpack: (webpackConfig: { resolve: { extensionAlias?: Record<string, string[]> } }) => {
    webpackConfig.resolve.extensionAlias = { '.js': ['.ts', '.tsx', '.js'] };
    return webpackConfig;
  },
};

export default config;
