import { defineConfig } from 'vitepress'
import { enConfig } from './config/en'
import AutoSidebar from 'vite-plugin-vitepress-auto-sidebar'

// Get Google Analytics ID from environment variables
const googleAnalyticsId = process.env.VITE_GA_ID

export default defineConfig({
    // Basic configuration
    title: 'Robota SDK',
    description: 'A simple, powerful TypeScript library for building AI agents with function calling, tool integration, and multi-provider support for OpenAI, Anthropic, and Google AI',

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
        'api-reference/:package/README.md': 'api-reference/:package/index.md'
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
                        'README.md',          // Now use README.md as is
                        'core-concepts.md',
                        'function-calling.md',
                        'building-agents.md'
                    ];

                    // Check if current path is guide folder
                    const isGuideFolder = data.some(file =>
                        guideOrder.some(guideFile => file.includes(guideFile))
                    );

                    if (isGuideFolder) {
                        // Sort files in guide folder in specified order
                        return data.sort((a, b) => {
                            const aIndex = guideOrder.findIndex(file => a.includes(file));
                            const bIndex = guideOrder.findIndex(file => b.includes(file));

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
                // sidebar completed hook, remove duplicates
                sideBarResolved: (sidebar) => {
                    // Debug: check sidebar structure
                    // console.log('sideBarResolved sidebar:', JSON.stringify(sidebar, null, 2));
                    const isPackageRoot = (key, link) => {
                        if (key !== '/api-reference/') return false;

                        if (!link) return false;

                        if (link.split('/').length !== 4) return false;

                        const packagePath = link.split('/').slice(0, 4).join('/');

                        return packagePath === link;
                    };

                    // Create default links for items without links
                    const ensureLinks = (key, basePath = '/', items) => {
                        if (!items) return items;

                        return items.map(item => {

                            // Create default link if no link
                            if (!item.link && item.items?.length) {
                                // If folder, create link based on text
                                const folderPath = item?.text?.toLowerCase().replace(/\s+/g, '-') || '';
                                const newLink = `${basePath}${folderPath ? `${folderPath}/` : ''}`;

                                item.isPackageRoot = isPackageRoot(key, newLink);

                                // item.link = newLink;
                            } else {
                                item.isPackageRoot = isPackageRoot(key, item.link);
                            }

                            // Recursively process subitems
                            if (item.items) {
                                const folderPath = item?.text?.toLowerCase().replace(/\s+/g, '-') || '';
                                const newBasePath = `${basePath}${folderPath ? `${folderPath}/` : ''}`;
                                item.items = ensureLinks(key, newBasePath, item.items);
                            }

                            return item;
                        });
                    };

                    const fixText = (key, items) => {
                        if (!items) return items;

                        return items.map(item => {
                            if (key === '/api-reference/') {
                                if (!item.link && item.items?.length && item.isPackageRoot) {
                                    item.text = `@robota-sdk/${item.text}`;
                                } else if (item.link && item.isPackageRoot && item.link.endsWith('/README.html')) {
                                    item.text = `Overview`;
                                } else if (item.text && !item.link && item.items?.length) {
                                    const text = item.text;
                                    item.text = text.charAt(0).toUpperCase() + text.slice(1);
                                }
                            }

                            if (item.items) {
                                item.items = fixText(key, item.items);
                            }
                            return item;
                        });
                    }

                    // Fix README.html links to correct path and improve text
                    const fixReadmeLinks = (key, items) => {
                        if (!items) return items;

                        return items.map(item => {
                            // Convert README.html links to index
                            if (item.link && item.link.endsWith('/README.html')) {
                                item.link = item.link.replace('/README.html', '/');
                            } else if (item.link && item.link.endsWith('README.html')) {
                                item.link = item.link.replace('README.html', '');
                            }

                            // Recursively process subitems
                            if (item.items) {
                                item.items = fixReadmeLinks(key, item.items);
                            }

                            return item;
                        });
                    };

                    // Process all sidebar sections
                    Object.keys(sidebar).forEach(key => {
                        if (Array.isArray(sidebar[key])) {
                            sidebar[key] = ensureLinks(key, key, sidebar[key]);
                            sidebar[key] = fixText(key, sidebar[key]);
                            sidebar[key] = fixReadmeLinks(key, sidebar[key]);
                        }
                    });

                    return sidebar;
                }
            })
        ]
    },

    // SEO and meta tags configuration
    head: [
        // Basic meta tags
        ['meta', { charset: 'utf-8' }],
        ['meta', { name: 'viewport', content: 'width=device-width, initial-scale=1' }],
        ['meta', { name: 'description', content: 'A simple, powerful TypeScript library for building AI agents with function calling, tool integration, and multi-provider support for OpenAI, Anthropic, and Google AI' }],
        ['meta', { name: 'keywords', content: 'AI, agent, LLM, function calling, TypeScript, JavaScript, OpenAI, Anthropic, Google AI, Claude, GPT, Gemini, tool integration, SDK, library, chatbot, conversational AI, artificial intelligence, machine learning, natural language processing, NLP' }],
        ['meta', { name: 'author', content: 'Robota SDK Team' }],
        ['meta', { name: 'robots', content: 'index, follow' }],

        // Open Graph tags
        ['meta', { property: 'og:type', content: 'website' }],
        ['meta', { property: 'og:title', content: 'Robota SDK - Build AI Agents with TypeScript' }],
        ['meta', { property: 'og:description', content: 'A simple, powerful TypeScript library for building AI agents with function calling, tool integration, and multi-provider support for OpenAI, Anthropic, and Google AI' }],
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
        ['meta', { name: 'twitter:description', content: 'A simple, powerful TypeScript library for building AI agents with function calling, tool integration, and multi-provider support for OpenAI, Anthropic, and Google AI' }],
        ['meta', { name: 'twitter:image', content: 'https://robota.io/og-image.png' }],
        ['meta', { name: 'twitter:image:alt', content: 'Robota SDK - Build AI Agents with TypeScript' }],

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
        ['script', { type: 'application/ld+json' }, JSON.stringify({
            '@context': 'https://schema.org',
            '@type': 'SoftwareApplication',
            'name': 'Robota SDK',
            'description': 'A simple, powerful TypeScript library for building AI agents with function calling, tool integration, and multi-provider support for OpenAI, Anthropic, and Google AI',
            'url': 'https://robota.io/',
            'applicationCategory': 'DeveloperApplication',
            'operatingSystem': 'Cross-platform',
            'programmingLanguage': ['TypeScript', 'JavaScript'],
            'author': {
                '@type': 'Organization',
                'name': 'Robota SDK Team'
            },
            'offers': {
                '@type': 'Offer',
                'price': '0',
                'priceCurrency': 'USD'
            },
            'downloadUrl': 'https://www.npmjs.com/package/@robota-sdk/agents',
            'codeRepository': 'https://github.com/woojubb/robota'
        })],

        // Google Analytics configuration
        ...(googleAnalyticsId ? [
            ['script', { async: true, src: `https://www.googletagmanager.com/gtag/js?id=${googleAnalyticsId}` }],
            ['script', {}, `
                window.dataLayer = window.dataLayer || [];
                function gtag(){dataLayer.push(arguments);}
                gtag('js', new Date());
                gtag('config', '${googleAnalyticsId}');
            `]
        ] : [])
    ],

    // Only English support
    ...enConfig,

    // Theme configuration
    themeConfig: {
        ...enConfig.themeConfig,
        search: {
            provider: 'local'
        },

        // Social links
        socialLinks: [
            { icon: 'github', link: 'https://github.com/woojubb/robota' },
            { icon: 'npm', link: 'https://www.npmjs.com/package/@robota-sdk/agents' }
        ]
    },

    // Build configuration - Use same path as GitHub Actions
    build: {
        outDir: './.vitepress/dist'
    },

    // Sitemap generation
    sitemap: {
        hostname: 'https://robota.io/'
    }
})