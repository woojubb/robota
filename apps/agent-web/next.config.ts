import type { NextConfig } from 'next';

// Bundle analyzer
const withBundleAnalyzer = require('@next/bundle-analyzer')({
  enabled: process.env.ANALYZE === 'true',
});

const nextConfig: NextConfig = {
  // ESLint configuration
  eslint: {
    // Do not run ESLint during builds. Lint is enforced separately (CI/PR),
    // while build remains focused on compilation/type correctness.
    ignoreDuringBuilds: true,
  },
  // TypeScript configuration
  // Do not ignore type errors during builds. Builds must fail on type errors.
  typescript: {
    ignoreBuildErrors: false,
  },
  // Performance optimizations
  experimental: {
    optimizePackageImports: [
      'lucide-react',
      '@radix-ui/react-icons',
      '@robota-sdk/agent-core',
    ],
  },

  // Compiler optimizations
  compiler: {
    // Keep console.log for debugging (temporarily disabled)
    removeConsole: false,
  },
};

export default withBundleAnalyzer(nextConfig);
