export const enConfig = {
    themeConfig: {
        // 네비게이션 메뉴
        nav: [
            { text: 'Home', link: '/' },
            { text: 'Guide', link: '/guide/' },
            { text: 'API Reference', link: '/api-reference/' },
            { text: 'Examples', link: '/examples/' }
        ],

        // 사이드바 설정
        sidebar: {
            '/guide/': [
                {
                    text: 'Introduction',
                    items: [
                        { text: 'Getting Started', link: '/guide/getting-started' },
                        { text: 'Core Concepts', link: '/guide/core-concepts' },
                        { text: 'Building Agents', link: '/guide/building-agents' }
                    ]
                },
                {
                    text: 'Advanced',
                    items: [
                        { text: 'Function Calling', link: '/guide/function-calling' },
                        { text: 'Providers', link: '/providers' },
                        { text: 'OpenAPI Integration', link: '/openapi-integration' },
                        { text: 'System Messages', link: '/system-messages' }
                    ]
                }
            ],
            '/api-reference/': [
                {
                    text: 'API Reference',
                    items: [
                        { text: 'Overview', link: '/api-reference/' },
                        { text: 'Core', link: '/api-reference/core/' },
                        { text: 'Tools', link: '/api-reference/tools/' },
                        { text: 'OpenAI', link: '/api-reference/openai/' },
                        { text: 'Anthropic', link: '/api-reference/anthropic/' },
                        { text: 'Google', link: '/api-reference/google/' }
                    ]
                }
            ],
            '/providers/': [
                {
                    text: 'AI Providers',
                    items: [
                        { text: 'Overview', link: '/providers' },
                        { text: 'OpenAI', link: '/providers/openai' },
                        { text: 'Anthropic', link: '/providers/anthropic' },
                        { text: 'Google', link: '/providers/google' },
                        { text: 'Custom Providers', link: '/providers/custom' }
                    ]
                }
            ],
            '/examples/': [
                {
                    text: 'Examples',
                    items: [
                        { text: 'Overview', link: '/examples/' },
                        { text: 'Basic Usage', link: '/examples' },
                        { text: 'Function Calling', link: '/guide/function-calling' },
                        { text: 'Tool Provider', link: '/guide/building-agents' }
                    ]
                }
            ]
        },

        // 푸터 설정
        footer: {
            message: 'Released under the MIT License.',
            copyright: 'Copyright © 2023-present'
        }
    }
} 