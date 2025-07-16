import type { Metadata } from 'next'
import Link from 'next/link'
import { Header } from '@/components/layout/header'
import { Footer } from '@/components/layout/footer'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { ArrowRight, Search, Book, Code2, Rocket, Users, Zap, Settings } from 'lucide-react'

export const metadata: Metadata = {
    title: 'Documentation - Robota',
    description: 'Complete documentation for Robota SDK. Learn how to build AI agents with our comprehensive guides, tutorials, and API reference.',
}

const quickStart = [
    {
        title: 'Installation',
        description: 'Get started with Robota SDK in minutes',
        href: '/docs/installation',
        time: '2 min read'
    },
    {
        title: 'Your First Agent',
        description: 'Build your first AI agent with a simple example',
        href: '/docs/quick-start',
        time: '5 min read'
    },
    {
        title: 'Adding Tools',
        description: 'Learn how to give your agents superpowers',
        href: '/docs/tools',
        time: '8 min read'
    }
]

const sections = [
    {
        icon: Book,
        title: 'Getting Started',
        description: 'Everything you need to know to start building with Robota',
        items: [
            { title: 'Installation', href: '/docs/installation' },
            { title: 'Quick Start Guide', href: '/docs/quick-start' },
            { title: 'Basic Concepts', href: '/docs/concepts' },
            { title: 'Configuration', href: '/docs/configuration' }
        ]
    },
    {
        icon: Code2,
        title: 'SDK Reference',
        description: 'Complete API documentation and code examples',
        items: [
            { title: 'Robota Class', href: '/docs/api/robota' },
            { title: 'Providers', href: '/docs/api/providers' },
            { title: 'Tools & Functions', href: '/docs/api/tools' },
            { title: 'Error Handling', href: '/docs/api/errors' }
        ]
    },
    {
        icon: Rocket,
        title: 'Advanced Usage',
        description: 'Take your AI agents to the next level',
        items: [
            { title: 'Streaming Responses', href: '/docs/advanced/streaming' },
            { title: 'Custom Providers', href: '/docs/advanced/providers' },
            { title: 'Plugin Development', href: '/docs/advanced/plugins' },
            { title: 'Performance Tuning', href: '/docs/advanced/performance' }
        ]
    },
    {
        icon: Users,
        title: 'Team Features',
        description: 'Collaborate and manage teams effectively',
        items: [
            { title: 'Team Management', href: '/docs/team/management' },
            { title: 'Permissions', href: '/docs/team/permissions' },
            { title: 'Shared Projects', href: '/docs/team/projects' },
            { title: 'Analytics', href: '/docs/team/analytics' }
        ]
    },
    {
        icon: Zap,
        title: 'Integrations',
        description: 'Connect Robota with your existing tools',
        items: [
            { title: 'REST API', href: '/docs/integrations/api' },
            { title: 'Webhooks', href: '/docs/integrations/webhooks' },
            { title: 'Database', href: '/docs/integrations/database' },
            { title: 'Cloud Platforms', href: '/docs/integrations/cloud' }
        ]
    },
    {
        icon: Settings,
        title: 'Deployment',
        description: 'Deploy your agents to production',
        items: [
            { title: 'Production Setup', href: '/docs/deployment/production' },
            { title: 'Environment Variables', href: '/docs/deployment/environment' },
            { title: 'Monitoring', href: '/docs/deployment/monitoring' },
            { title: 'Scaling', href: '/docs/deployment/scaling' }
        ]
    }
]

const popularGuides = [
    {
        title: 'Build a Customer Support Bot',
        description: 'Create an intelligent customer support agent with function calling',
        time: '15 min',
        difficulty: 'Beginner',
        href: '/docs/guides/support-bot'
    },
    {
        title: 'Multi-Provider Setup',
        description: 'Use multiple AI providers with fallbacks and load balancing',
        time: '20 min',
        difficulty: 'Intermediate',
        href: '/docs/guides/multi-provider'
    },
    {
        title: 'RAG with Vector Database',
        description: 'Implement retrieval-augmented generation with embeddings',
        time: '30 min',
        difficulty: 'Advanced',
        href: '/docs/guides/rag'
    }
]

export default function DocsPage() {
    return (
        <div className="min-h-screen flex flex-col">
            <Header />
            <main className="flex-1">
                {/* Hero Section */}
                <section className="relative overflow-hidden pt-20 pb-16 sm:pt-32 sm:pb-24">
                    <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-transparent to-accent/5" />

                    <div className="container relative">
                        <div className="mx-auto max-w-4xl text-center">
                            <Badge variant="secondary" className="mb-6">
                                📚 Documentation
                            </Badge>

                            <h1 className="text-4xl font-bold tracking-tight text-foreground sm:text-6xl lg:text-7xl mb-6">
                                Build AI agents with{' '}
                                <span className="bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
                                    confidence
                                </span>
                            </h1>

                            <p className="text-xl text-muted-foreground max-w-3xl mx-auto mb-10">
                                Everything you need to master Robota SDK. From beginner tutorials
                                to advanced deployment guides, we've got you covered.
                            </p>

                            {/* Search Bar */}
                            <div className="relative max-w-md mx-auto mb-10">
                                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                                <Input
                                    placeholder="Search documentation..."
                                    className="pl-10 pr-4 py-3 text-lg"
                                />
                            </div>

                            <div className="flex flex-col sm:flex-row gap-4 justify-center">
                                <Button size="lg" asChild>
                                    <Link href="/docs/quick-start">
                                        Get Started
                                        <ArrowRight className="ml-2 h-5 w-5" />
                                    </Link>
                                </Button>
                                <Button size="lg" variant="outline" asChild>
                                    <Link href="/playground">
                                        Try Playground
                                    </Link>
                                </Button>
                            </div>
                        </div>
                    </div>
                </section>

                {/* Quick Start */}
                <section className="py-24">
                    <div className="container">
                        <div className="mx-auto max-w-4xl text-center mb-16">
                            <h2 className="text-3xl font-bold tracking-tight sm:text-4xl mb-6">
                                Quick Start
                            </h2>
                            <p className="text-xl text-muted-foreground">
                                Get up and running in minutes with these essential guides
                            </p>
                        </div>

                        <div className="grid gap-6 md:grid-cols-3">
                            {quickStart.map((item, index) => (
                                <Card key={index} className="hover:shadow-lg transition-shadow">
                                    <CardHeader>
                                        <div className="flex items-center justify-between">
                                            <Badge variant="outline">{item.time}</Badge>
                                            <span className="text-2xl font-bold text-primary">{index + 1}</span>
                                        </div>
                                        <CardTitle className="text-xl">{item.title}</CardTitle>
                                        <CardDescription>{item.description}</CardDescription>
                                    </CardHeader>
                                    <CardContent>
                                        <Button asChild className="w-full">
                                            <Link href={item.href}>
                                                Start Reading
                                                <ArrowRight className="ml-2 h-4 w-4" />
                                            </Link>
                                        </Button>
                                    </CardContent>
                                </Card>
                            ))}
                        </div>
                    </div>
                </section>

                {/* Documentation Sections */}
                <section className="py-24 bg-muted/30">
                    <div className="container">
                        <div className="mx-auto max-w-4xl text-center mb-16">
                            <h2 className="text-3xl font-bold tracking-tight sm:text-4xl mb-6">
                                Explore Documentation
                            </h2>
                            <p className="text-xl text-muted-foreground">
                                Comprehensive guides organized by topic
                            </p>
                        </div>

                        <div className="grid gap-8 md:grid-cols-2 lg:grid-cols-3">
                            {sections.map((section, index) => {
                                const Icon = section.icon
                                return (
                                    <Card key={index} className="h-full">
                                        <CardHeader>
                                            <div className="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-lg bg-primary/10">
                                                <Icon className="h-6 w-6 text-primary" />
                                            </div>
                                            <CardTitle className="text-xl">{section.title}</CardTitle>
                                            <CardDescription>{section.description}</CardDescription>
                                        </CardHeader>
                                        <CardContent>
                                            <ul className="space-y-3">
                                                {section.items.map((item, itemIndex) => (
                                                    <li key={itemIndex}>
                                                        <Link
                                                            href={item.href}
                                                            className="text-sm text-muted-foreground hover:text-foreground transition-colors flex items-center group"
                                                        >
                                                            {item.title}
                                                            <ArrowRight className="ml-1 h-3 w-3 opacity-0 group-hover:opacity-100 transition-opacity" />
                                                        </Link>
                                                    </li>
                                                ))}
                                            </ul>
                                        </CardContent>
                                    </Card>
                                )
                            })}
                        </div>
                    </div>
                </section>

                {/* Popular Guides */}
                <section className="py-24">
                    <div className="container">
                        <div className="mx-auto max-w-4xl text-center mb-16">
                            <h2 className="text-3xl font-bold tracking-tight sm:text-4xl mb-6">
                                Popular Guides
                            </h2>
                            <p className="text-xl text-muted-foreground">
                                Step-by-step tutorials for common use cases
                            </p>
                        </div>

                        <div className="grid gap-8 md:grid-cols-3">
                            {popularGuides.map((guide, index) => (
                                <Card key={index} className="hover:shadow-lg transition-shadow">
                                    <CardHeader>
                                        <div className="flex items-center gap-2 mb-2">
                                            <Badge variant="secondary">{guide.time}</Badge>
                                            <Badge variant={guide.difficulty === 'Beginner' ? 'default' : guide.difficulty === 'Intermediate' ? 'secondary' : 'destructive'}>
                                                {guide.difficulty}
                                            </Badge>
                                        </div>
                                        <CardTitle className="text-xl">{guide.title}</CardTitle>
                                        <CardDescription>{guide.description}</CardDescription>
                                    </CardHeader>
                                    <CardContent>
                                        <Button asChild variant="outline" className="w-full">
                                            <Link href={guide.href}>
                                                Read Guide
                                                <ArrowRight className="ml-2 h-4 w-4" />
                                            </Link>
                                        </Button>
                                    </CardContent>
                                </Card>
                            ))}
                        </div>
                    </div>
                </section>

                {/* CTA Section */}
                <section className="py-24 bg-gradient-to-b from-background to-muted/30">
                    <div className="container">
                        <div className="mx-auto max-w-4xl text-center">
                            <h2 className="text-3xl font-bold tracking-tight sm:text-4xl mb-6">
                                Need Help?
                            </h2>

                            <p className="text-xl text-muted-foreground mb-10 max-w-2xl mx-auto">
                                Can't find what you're looking for? Our community and support team
                                are here to help you succeed.
                            </p>

                            <div className="grid gap-6 md:grid-cols-3">
                                <Card>
                                    <CardHeader>
                                        <CardTitle className="text-lg">Discord Community</CardTitle>
                                        <CardDescription>
                                            Get help from fellow developers and the Robota team
                                        </CardDescription>
                                    </CardHeader>
                                    <CardContent>
                                        <Button asChild className="w-full">
                                            <Link href="https://discord.gg/robota" target="_blank">
                                                Join Discord
                                            </Link>
                                        </Button>
                                    </CardContent>
                                </Card>

                                <Card>
                                    <CardHeader>
                                        <CardTitle className="text-lg">GitHub Issues</CardTitle>
                                        <CardDescription>
                                            Report bugs or request new features
                                        </CardDescription>
                                    </CardHeader>
                                    <CardContent>
                                        <Button asChild variant="outline" className="w-full">
                                            <Link href="https://github.com/robota-ai/robota/issues" target="_blank">
                                                Open Issue
                                            </Link>
                                        </Button>
                                    </CardContent>
                                </Card>

                                <Card>
                                    <CardHeader>
                                        <CardTitle className="text-lg">Enterprise Support</CardTitle>
                                        <CardDescription>
                                            Priority support for enterprise customers
                                        </CardDescription>
                                    </CardHeader>
                                    <CardContent>
                                        <Button asChild variant="outline" className="w-full">
                                            <Link href="/contact">
                                                Contact Sales
                                            </Link>
                                        </Button>
                                    </CardContent>
                                </Card>
                            </div>
                        </div>
                    </div>
                </section>
            </main>
            <Footer />
        </div>
    )
} 