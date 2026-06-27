import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

export default withNextIntl({
  output: 'export',
  // Static export can't run the Image Optimization API at runtime; make the strategy
  // explicit (parity with apps/docs) so `next/image` resolves unoptimized assets.
  images: { unoptimized: true },
} satisfies NextConfig);
