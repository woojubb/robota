import { defineConfig } from 'vitepress'
import { enConfig } from './config/en'

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