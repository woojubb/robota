// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import rehypePrettyCode from 'rehype-pretty-code';
import rehypeAutolinkHeadings from 'rehype-autolink-headings';
import remarkToc from 'remark-toc';

export default defineConfig({
  site: 'https://blog.robota.io',
  integrations: [sitemap()],
  markdown: {
    syntaxHighlight: false,
    remarkPlugins: [remarkToc],
    rehypePlugins: [
      [rehypePrettyCode, { theme: 'github-dark' }],
      [rehypeAutolinkHeadings, { behavior: 'wrap' }],
    ],
  },
});
