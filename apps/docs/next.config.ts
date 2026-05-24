import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

export default withNextIntl({
  output: 'export',
  trailingSlash: true,
  images: { unoptimized: true },
} satisfies NextConfig);
