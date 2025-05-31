import { defineConfig } from 'vitepress'
import { enConfig } from './config/en'
import AutoSidebar from 'vite-plugin-vitepress-auto-sidebar'

// Google Analytics ID를 환경변수에서 가져오기
const googleAnalyticsId = process.env.VITE_GA_ID

export default defineConfig({
    // 기본 설정
    title: 'Robota SDK',
    description: 'A simple, powerful TypeScript library for building AI agents with function calling, tool integration, and multi-provider support for OpenAI, Anthropic, and Google AI',

    // SEO 설정
    lang: 'en-US',

    // 문서 소스 디렉토리 설정 (임시 디렉토리 사용)
    srcDir: './.temp',

    // 깨진 링크 무시 설정
    ignoreDeadLinks: true,

    // README.md를 index로 자동 인식
    rewrites: {
        'README.md': 'index.md',
        ':dir/README.md': ':dir/index.md',
        'api-reference/:package/README.md': 'api-reference/:package/index.md'
    },

    // Vite 플러그인 설정
    vite: {
        plugins: [
            AutoSidebar({
                path: './.temp',
                ignoreList: ['.vitepress', 'node_modules', 'scripts'],
                collapsed: false,
                titleFromFile: true,
                titleFromFileByYaml: true,
                // 파일 순서 정렬을 위한 훅
                beforeCreateSideBarItems: (data) => {
                    // guide 폴더의 파일들을 특정 순서로 정렬
                    const guideOrder = [
                        'README.md',          // 이제 README.md를 그대로 사용
                        'core-concepts.md',
                        'function-calling.md',
                        'building-agents.md'
                    ];

                    // 현재 경로가 guide 폴더인지 확인
                    const isGuideFolder = data.some(file =>
                        guideOrder.some(guideFile => file.includes(guideFile))
                    );

                    if (isGuideFolder) {
                        // guide 폴더의 파일들을 지정된 순서로 정렬
                        return data.sort((a, b) => {
                            const aIndex = guideOrder.findIndex(file => a.includes(file));
                            const bIndex = guideOrder.findIndex(file => b.includes(file));

                            // 둘 다 guide 파일이면 순서대로
                            if (aIndex !== -1 && bIndex !== -1) {
                                return aIndex - bIndex;
                            }
                            // 하나만 guide 파일이면 guide 파일을 앞으로
                            if (aIndex !== -1) return -1;
                            if (bIndex !== -1) return 1;
                            // 둘 다 guide 파일이 아니면 원래 순서 유지
                            return 0;
                        });
                    }

                    // 다른 폴더는 원래 순서 유지
                    return data;
                },
                // sidebar 완성 후 중복 제거
                sideBarResolved: (sidebar) => {
                    // 디버깅: sidebar 구조 확인
                    // console.log('sideBarResolved sidebar:', JSON.stringify(sidebar, null, 2));
                    const isPackageRoot = (key, link) => {
                        if (key !== '/api-reference/') return false;

                        if (!link) return false;

                        if (link.split('/').length !== 4) return false;

                        const packagePath = link.split('/').slice(0, 4).join('/');

                        return packagePath === link;
                    };

                    // 링크가 없는 항목들에 기본 링크 생성
                    const ensureLinks = (key, basePath = '/', items) => {
                        if (!items) return items;

                        return items.map(item => {

                            // 링크가 없는 경우 기본 링크 생성
                            if (!item.link && item.items?.length) {
                                // 폴더인 경우, 텍스트를 기반으로 링크 생성
                                const folderPath = item?.text?.toLowerCase().replace(/\s+/g, '-') || '';
                                const newLink = `${basePath}${folderPath ? `${folderPath}/` : ''}`;

                                item.isPackageRoot = isPackageRoot(key, newLink);

                                // item.link = newLink;
                            } else {
                                item.isPackageRoot = isPackageRoot(key, item.link);
                            }

                            // 하위 항목들도 재귀적으로 처리
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

                    // README.html 링크를 올바른 경로로 변환하고 텍스트 개선
                    const fixReadmeLinks = (key, items) => {
                        if (!items) return items;

                        return items.map(item => {
                            // README.html 링크를 index로 변환
                            if (item.link && item.link.endsWith('/README.html')) {
                                item.link = item.link.replace('/README.html', '/');
                            } else if (item.link && item.link.endsWith('README.html')) {
                                item.link = item.link.replace('README.html', '');
                            }

                            // 하위 항목들도 재귀적으로 처리
                            if (item.items) {
                                item.items = fixReadmeLinks(key, item.items);
                            }

                            return item;
                        });
                    };

                    // 모든 sidebar 섹션에 대해 처리
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

    // SEO 및 메타 태그 설정
    head: [
        // 기본 메타 태그
        ['meta', { charset: 'utf-8' }],
        ['meta', { name: 'viewport', content: 'width=device-width, initial-scale=1' }],
        ['meta', { name: 'description', content: 'A simple, powerful TypeScript library for building AI agents with function calling, tool integration, and multi-provider support for OpenAI, Anthropic, and Google AI' }],
        ['meta', { name: 'keywords', content: 'AI, agent, LLM, function calling, TypeScript, JavaScript, OpenAI, Anthropic, Google AI, Claude, GPT, Gemini, tool integration, SDK, library, chatbot, conversational AI, artificial intelligence, machine learning, natural language processing, NLP' }],
        ['meta', { name: 'author', content: 'Robota SDK Team' }],
        ['meta', { name: 'robots', content: 'index, follow' }],

        // Open Graph 태그
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

        // Twitter Card 태그
        ['meta', { name: 'twitter:card', content: 'summary_large_image' }],
        ['meta', { name: 'twitter:title', content: 'Robota SDK - Build AI Agents with TypeScript' }],
        ['meta', { name: 'twitter:description', content: 'A simple, powerful TypeScript library for building AI agents with function calling, tool integration, and multi-provider support for OpenAI, Anthropic, and Google AI' }],
        ['meta', { name: 'twitter:image', content: 'https://robota.io/og-image.png' }],
        ['meta', { name: 'twitter:image:alt', content: 'Robota SDK - Build AI Agents with TypeScript' }],

        // 추가 SEO 태그
        ['meta', { name: 'theme-color', content: '#646cff' }],
        ['meta', { name: 'msapplication-TileColor', content: '#646cff' }],
        ['link', { rel: 'canonical', href: 'https://robota.io/' }],

        // 파비콘
        ['link', { rel: 'icon', type: 'image/x-icon', href: '/favicon.ico' }],
        ['link', { rel: 'icon', type: 'image/png', sizes: '32x32', href: '/favicon-32x32.png' }],
        ['link', { rel: 'icon', type: 'image/png', sizes: '16x16', href: '/favicon-16x16.png' }],
        ['link', { rel: 'apple-touch-icon', sizes: '180x180', href: '/apple-touch-icon.png' }],

        // PWA Manifest
        ['link', { rel: 'manifest', href: '/manifest.json' }],

        // JSON-LD 구조화 데이터
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
            'downloadUrl': 'https://www.npmjs.com/package/@robota-sdk/core',
            'codeRepository': 'https://github.com/woojubb/robota'
        })],

        // Google Analytics 설정
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

    // 영어만 지원
    ...enConfig,

    // 테마 설정
    themeConfig: {
        ...enConfig.themeConfig,
        search: {
            provider: 'local'
        },

        // 소셜 링크
        socialLinks: [
            { icon: 'github', link: 'https://github.com/woojubb/robota' },
            { icon: 'npm', link: 'https://www.npmjs.com/package/@robota-sdk/core' }
        ]
    },

    // 빌드 설정 - GitHub Actions와 동일한 경로 사용
    build: {
        outDir: './.vitepress/dist'
    },

    // 사이트맵 생성
    sitemap: {
        hostname: 'https://robota.io/'
    }
})