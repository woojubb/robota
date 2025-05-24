export const koConfig = {
    themeConfig: {
        // 네비게이션 메뉴
        nav: [
            { text: '홈', link: '/ko/' },
            { text: '가이드', link: '/ko/guide/' },
            { text: 'API 레퍼런스', link: '/ko/api-reference/' },
            { text: '예제', link: '/ko/examples/' }
        ],

        // 사이드바 설정
        sidebar: {
            '/ko/guide/': [
                {
                    text: '소개',
                    items: [
                        { text: '시작하기', link: '/ko/guide/getting-started' },
                        { text: '핵심 개념', link: '/ko/guide/core-concepts' },
                        { text: '에이전트 구축하기', link: '/ko/guide/building-agents' }
                    ]
                },
                {
                    text: '고급',
                    items: [
                        { text: '함수 호출', link: '/ko/guide/function-calling' },
                        { text: '프로바이더', link: '/ko/providers' },
                        { text: 'OpenAPI 통합', link: '/ko/openapi-integration' },
                        { text: '시스템 메시지', link: '/ko/system-messages' }
                    ]
                }
            ],
            '/ko/api-reference/': [
                {
                    text: 'API 레퍼런스',
                    items: [
                        { text: '개요', link: '/ko/api-reference/' },
                        { text: '코어', link: '/ko/api-reference/core/' },
                        { text: '도구', link: '/ko/api-reference/tools/' },
                        { text: 'OpenAI', link: '/ko/api-reference/openai/' },
                        { text: 'Anthropic', link: '/ko/api-reference/anthropic/' }
                    ]
                }
            ],
            '/ko/examples/': [
                {
                    text: '예제',
                    items: [
                        { text: '개요', link: '/ko/examples/' },
                        { text: '기본 사용법', link: '/ko/examples' },
                        { text: '함수 호출', link: '/ko/guide/function-calling' },
                        { text: '도구 프로바이더', link: '/ko/guide/building-agents' }
                    ]
                }
            ]
        },

        // 푸터 설정
        footer: {
            message: 'MIT 라이센스로 배포됨',
            copyright: 'Copyright © 2023-present'
        }
    }
} 