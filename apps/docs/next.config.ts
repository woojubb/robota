import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';
import { productPublicConfig } from './src/lib/product-config.generated';

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

export default withNextIntl({
  output: 'export',
  // Compound route sources are discovered only for products with a documentation URL.
  pageExtensions: [
    ...(productPublicConfig.identity.docsUrl ? ['llms.ts'] : []),
    'tsx',
    'ts',
    'jsx',
    'js',
  ],
  trailingSlash: true,
  images: { unoptimized: true },
} satisfies NextConfig);
