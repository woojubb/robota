import { BrandConfig } from '@/types'

export const BRAND: BrandConfig = {
    name: 'Robota',
    tagline: 'Build AI Agents with Confidence',
    description: 'The ultimate platform for building, testing, and deploying AI agents with our powerful SDK and cloud infrastructure.'
}

export const SITE = {
    title: 'Robota - Build AI Agents with Confidence',
    description: BRAND.description,
    url: 'https://robota.dev',
    ogImage: '/og-image.png',
    keywords: ['AI', 'agents', 'SDK', 'playground', 'API', 'robota', 'artificial intelligence', 'development'],
    author: 'Robota Team',
    email: 'contact@robota.dev',
    social: {
        github: 'https://github.com/robota-ai/robota',
        twitter: 'https://twitter.com/robota_ai',
        discord: 'https://discord.gg/robota'
    }
}

export const NAVIGATION = {
    main: [
        { title: 'Home', href: '/' },
        { title: 'Playground', href: '/playground' },
        { title: 'API', href: '/api' },
        { title: 'Docs', href: '/docs' },
        { title: 'Pricing', href: '/pricing' }
    ],
    footer: [
        {
            title: 'Product',
            items: [
                { title: 'Playground', href: '/playground' },
                { title: 'API Service', href: '/api' },
                { title: 'Templates', href: '/templates' },
                { title: 'Integrations', href: '/integrations' }
            ]
        },
        {
            title: 'Resources',
            items: [
                { title: 'Documentation', href: '/docs' },
                { title: 'Tutorials', href: '/tutorials' },
                { title: 'Examples', href: '/examples' },
                { title: 'Blog', href: '/blog' }
            ]
        },
        {
            title: 'Community',
            items: [
                { title: 'GitHub', href: SITE.social.github, external: true },
                { title: 'Discord', href: SITE.social.discord, external: true },
                { title: 'Twitter', href: SITE.social.twitter, external: true }
            ]
        },
        {
            title: 'Company',
            items: [
                { title: 'About', href: '/about' },
                { title: 'Contact', href: '/contact' },
                { title: 'Privacy', href: '/privacy' },
                { title: 'Terms', href: '/terms' }
            ]
        }
    ]
}

export const FEATURES = {
    hero: [
        {
            title: 'Real-time Playground',
            description: 'Build and test AI agents with our browser-based editor featuring Monaco IDE and instant execution.',
            icon: 'Code'
        },
        {
            title: 'Multi-Provider API',
            description: 'Unified API supporting OpenAI, Anthropic, Google and more with intelligent load balancing.',
            icon: 'Zap'
        },
        {
            title: 'Team Collaboration',
            description: 'Share projects, collaborate in real-time, and manage team access with enterprise-grade features.',
            icon: 'Users'
        }
    ],
    detailed: [
        {
            title: 'Powerful Playground',
            description: 'Professional development environment with syntax highlighting, auto-completion, and debugging.',
            features: [
                'Monaco Editor with TypeScript support',
                'Real-time code execution and testing',
                'Built-in template library',
                'Project sharing and forking',
                'Version control integration'
            ]
        },
        {
            title: 'Production-Ready API',
            description: 'Scalable API infrastructure with enterprise-grade security and reliability.',
            features: [
                'OpenAI-compatible endpoints',
                'Multi-provider routing',
                'Usage analytics and monitoring',
                'Rate limiting and quotas',
                'API key management'
            ]
        },
        {
            title: 'Developer Experience',
            description: 'Everything you need to build, test, and deploy AI agents efficiently.',
            features: [
                'Comprehensive documentation',
                'Interactive tutorials',
                'Community templates',
                'Discord support',
                'Regular updates'
            ]
        }
    ]
}

export const PRICING = {
    plans: [
        {
            name: 'Free',
            price: 0,
            period: 'month',
            description: 'Perfect for experimenting and learning',
            features: [
                '1,000 API calls/month',
                'Basic playground access',
                'Community templates',
                'Discord support'
            ],
            popular: false
        },
        {
            name: 'Starter',
            price: 29,
            period: 'month',
            description: 'For individuals and small projects',
            features: [
                '10,000 API calls/month',
                'Full playground features',
                'Private projects',
                'Priority support',
                'Usage analytics'
            ],
            popular: true
        },
        {
            name: 'Pro',
            price: 99,
            period: 'month',
            description: 'For teams and growing businesses',
            features: [
                '100,000 API calls/month',
                'Team collaboration',
                'Custom templates',
                'Advanced analytics',
                'SLA guarantees'
            ],
            popular: false
        },
        {
            name: 'Enterprise',
            price: null,
            period: 'month',
            description: 'For large organizations with custom needs',
            features: [
                'Unlimited API calls',
                'On-premise deployment',
                'Custom integrations',
                'Dedicated support',
                'Training sessions'
            ],
            popular: false
        }
    ]
} 