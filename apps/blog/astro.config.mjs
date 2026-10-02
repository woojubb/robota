// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import rehypePrettyCode from 'rehype-pretty-code';
import rehypeAutolinkHeadings from 'rehype-autolink-headings';
import remarkToc from 'remark-toc';
import remarkMermaid from './src/plugins/remark-mermaid.mjs';
import { productPublicConfig } from './src/lib/product-config.generated.mjs';

export default defineConfig({
  ...(productPublicConfig.identity.blogUrl ? { site: productPublicConfig.identity.blogUrl } : {}),
  i18n: {
    defaultLocale: 'en',
    locales: ['en', 'ko'],
    routing: {
      prefixDefaultLocale: false,
    },
  },
  integrations: [sitemap()],
  markdown: {
    syntaxHighlight: false,
    remarkPlugins: [remarkMermaid, remarkToc],
    rehypePlugins: [
      [rehypePrettyCode, { theme: 'github-dark' }],
      [rehypeAutolinkHeadings, { behavior: 'wrap' }],
    ],
  },
});
