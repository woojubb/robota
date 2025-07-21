import type { NextConfig } from "next";

// Bundle analyzer
const withBundleAnalyzer = require('@next/bundle-analyzer')({
  enabled: process.env.ANALYZE === 'true',
});

const nextConfig: NextConfig = {
  // Image optimization configuration
  images: {
    // Enable image optimization
    formats: ['image/webp', 'image/avif'],

    // Allowed domains for external images
    domains: [
      'firebasestorage.googleapis.com',
      'lh3.googleusercontent.com', // Google profile images
      'avatars.githubusercontent.com', // GitHub profile images
    ],

    // Remote patterns for more flexible matching
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'firebasestorage.googleapis.com',
        pathname: '/v0/b/**',
      },
      {
        protocol: 'https',
        hostname: '*.googleusercontent.com',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'avatars.githubusercontent.com',
        pathname: '/**',
      },
    ],

    // Image sizes for optimization
    deviceSizes: [640, 750, 828, 1080, 1200, 1920, 2048, 3840],
    imageSizes: [16, 32, 48, 64, 96, 128, 256, 384],

    // Enable lazy loading by default
    loader: 'default',

    // Minimize layout shift
    minimumCacheTTL: 60,
  },

  // Performance optimizations
  experimental: {
    optimizePackageImports: ['lucide-react', '@radix-ui/react-icons'],
  },

  // Compiler optimizations
  compiler: {
    // Remove console.log in production
    removeConsole: process.env.NODE_ENV === 'production',
  },

  // Remove complex webpack configuration
  // Next.js should handle server/client separation automatically
};

export default withBundleAnalyzer(nextConfig);
