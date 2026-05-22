import { defineConfig } from 'vitepress';
import { enConfig } from './config/en';
import AutoSidebar from 'vite-plugin-vitepress-auto-sidebar';

const googleAnalyticsId = 'G-ZPV4BX97JF';

export default defineConfig({
  // Basic configuration
  title: 'Robota SDK',
  description:
    'The open-source alternative to Claude Code. Multi-provider AI agent SDK and CLI — TypeScript-native, self-hostable. Supports Anthropic, OpenAI, DeepSeek, Gemini, and local models.',

  // SEO configuration
  lang: 'en-US',

  // Document source directory configuration (using temporary directory)
  srcDir: './.temp',

  // Ignore broken links configuration
  ignoreDeadLinks: true,

  // Automatically recognize README.md as index
  rewrites: {
    'README.md': 'index.md',
    ':dir/README.md': ':dir/index.md',
  },

  // Vite plugin configuration
  vite: {
    plugins: [
      AutoSidebar({
        path: './.temp',
        ignoreList: ['.vitepress', 'node_modules', 'scripts'],
        collapsed: false,
        titleFromFile: true,
        titleFromFileByYaml: true,
        // Hook for file ordering
        beforeCreateSideBarItems: (data) => {
          // Sort files in guide folder in specific order
          const guideOrder = [
            'README.md',
            'architecture.md',
            'building-agents.md',
            'sdk.md',
            'cli.md',
            'local-llm.md',
            'permissions-and-hooks.md',
            'context-management.md',
          ];

          // Check if current path is guide folder
          const isGuideFolder = data.some((file) =>
            guideOrder.some((guideFile) => file.includes(guideFile)),
          );

          if (isGuideFolder) {
            // Sort files in guide folder in specified order
            return data.sort((a, b) => {
              const aIndex = guideOrder.findIndex((file) => a.includes(file));
              const bIndex = guideOrder.findIndex((file) => b.includes(file));

              // Both are guide files, order them
              if (aIndex !== -1 && bIndex !== -1) {
                return aIndex - bIndex;
              }
              // One is guide file, put it first
              if (aIndex !== -1) return -1;
              if (bIndex !== -1) return 1;
              // Both are not guide files, keep original order
              return 0;
            });
          }

          // Other folders keep original order
          return data;
        },
        // sidebar completed hook
        sideBarResolved: (sidebar) => {
          // Fix README.html links to correct path
          const fixReadmeLinks = (items) => {
            if (!items) return items;
            return items.map((item) => {
              if (item.link && item.link.endsWith('/README.html')) {
                item.link = item.link.replace('/README.html', '/');
              } else if (item.link && item.link.endsWith('README.html')) {
                item.link = item.link.replace('README.html', '');
              }
              if (item.items) {
                item.items = fixReadmeLinks(item.items);
              }
              return item;
            });
          };

          Object.keys(sidebar).forEach((key) => {
            if (Array.isArray(sidebar[key])) {
              sidebar[key] = fixReadmeLinks(sidebar[key]);
            }
          });

          return sidebar;
        },
      }),
    ],
  },

  // SEO and meta tags configuration
  head: [
    // Basic meta tags
    ['meta', { charset: 'utf-8' }],
    ['meta', { name: 'viewport', content: 'width=device-width, initial-scale=1' }],
    [
      'meta',
      {
        name: 'description',
        content:
          'The open-source alternative to Claude Code. Multi-provider AI agent SDK and CLI — TypeScript-native, self-hostable. Supports Anthropic, OpenAI, DeepSeek, Gemini, and local models.',
      },
    ],
    [
      'meta',
      {
        name: 'keywords',
        content:
          'AI agent SDK, TypeScript AI agent, Claude Code alternative, open source AI CLI, multi-provider AI, LangChain alternative TypeScript, AI coding assistant, self-hostable AI, DeepSeek TypeScript, OpenAI agents SDK alternative, MCP server TypeScript, build coding agent CLI',
      },
    ],
    ['meta', { name: 'author', content: 'Robota SDK Team' }],
    ['meta', { name: 'robots', content: 'index, follow' }],

    // Open Graph tags
    ['meta', { property: 'og:type', content: 'website' }],
    [
      'meta',
      { property: 'og:title', content: 'Robota SDK — The open-source Claude Code alternative' },
    ],
    [
      'meta',
      {
        property: 'og:description',
        content:
          'The open-source alternative to Claude Code. Multi-provider AI agent SDK and CLI — TypeScript-native, self-hostable. Supports Anthropic, OpenAI, DeepSeek, Gemini, and local models.',
      },
    ],
    ['meta', { property: 'og:url', content: 'https://robota.io/' }],
    ['meta', { property: 'og:site_name', content: 'Robota SDK' }],
    ['meta', { property: 'og:image', content: 'https://robota.io/og-image.png' }],
    ['meta', { property: 'og:image:width', content: '1200' }],
    ['meta', { property: 'og:image:height', content: '630' }],
    ['meta', { property: 'og:image:alt', content: 'Robota SDK - Build AI Agents with TypeScript' }],
    ['meta', { property: 'og:locale', content: 'en_US' }],

    // Twitter Card tags
    ['meta', { name: 'twitter:card', content: 'summary_large_image' }],
    ['meta', { name: 'twitter:title', content: 'Robota SDK - Build AI Agents with TypeScript' }],
    [
      'meta',
      {
        name: 'twitter:description',
        content:
          'The open-source alternative to Claude Code. Multi-provider AI agent SDK and CLI — TypeScript-native, self-hostable. Supports Anthropic, OpenAI, DeepSeek, Gemini, and local models.',
      },
    ],
    ['meta', { name: 'twitter:image', content: 'https://robota.io/og-image.png' }],
    [
      'meta',
      { name: 'twitter:image:alt', content: 'Robota SDK - Build AI Agents with TypeScript' },
    ],

    // Additional SEO tags
    ['meta', { name: 'theme-color', content: '#646cff' }],
    ['meta', { name: 'msapplication-TileColor', content: '#646cff' }],
    ['link', { rel: 'canonical', href: 'https://robota.io/' }],

    // Favicons
    ['link', { rel: 'icon', type: 'image/x-icon', href: '/favicon.ico' }],
    ['link', { rel: 'icon', type: 'image/png', sizes: '32x32', href: '/favicon-32x32.png' }],
    ['link', { rel: 'icon', type: 'image/png', sizes: '16x16', href: '/favicon-16x16.png' }],
    ['link', { rel: 'apple-touch-icon', sizes: '180x180', href: '/apple-touch-icon.png' }],

    // PWA Manifest
    ['link', { rel: 'manifest', href: '/manifest.json' }],

    // JSON-LD structured data
    [
      'script',
      { type: 'application/ld+json' },
      JSON.stringify({
        '@context': 'https://schema.org',
        '@type': 'SoftwareApplication',
        name: 'Robota SDK',
        description:
          'The open-source alternative to Claude Code. Multi-provider AI agent SDK and CLI — TypeScript-native, self-hostable. Supports Anthropic, OpenAI, DeepSeek, Gemini, and local models.',
        url: 'https://robota.io/',
        applicationCategory: 'DeveloperApplication',
        operatingSystem: 'Cross-platform',
        programmingLanguage: ['TypeScript', 'JavaScript'],
        author: {
          '@type': 'Organization',
          name: 'Robota SDK Team',
        },
        offers: {
          '@type': 'Offer',
          price: '0',
          priceCurrency: 'USD',
        },
        downloadUrl: 'https://www.npmjs.com/package/@robota-sdk/agent-cli',
        codeRepository: 'https://github.com/woojubb/robota',
      }),
    ],

    // Mermaid diagram support
    ['script', { defer: true, src: 'https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.min.js' }],

    // Google Analytics configuration
    ...(googleAnalyticsId
      ? [
          [
            'script',
            {
              async: true,
              src: `https://www.googletagmanager.com/gtag/js?id=${googleAnalyticsId}`,
            },
          ],
          [
            'script',
            {},
            `
                window.dataLayer = window.dataLayer || [];
                function gtag(){dataLayer.push(arguments);}
                gtag('js', new Date());
                gtag('config', '${googleAnalyticsId}');
            `,
          ],
        ]
      : []),
  ],

  // Only English support
  ...enConfig,

  // Theme configuration
  themeConfig: {
    ...enConfig.themeConfig,
    search: {
      provider: 'local',
    },

    // Social links
    socialLinks: [
      { icon: 'github', link: 'https://github.com/woojubb/robota' },
      { icon: 'npm', link: 'https://www.npmjs.com/package/@robota-sdk/agent-cli' },
    ],
  },

  // Build configuration - Use same path as GitHub Actions
  build: {
    outDir: './.vitepress/dist',
  },

  // Sitemap generation
  sitemap: {
    hostname: 'https://robota.io/',
  },
});
