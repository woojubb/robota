import type { Metadata } from 'next'
import Link from 'next/link'
import { Header } from '@/components/layout/header'
import { Footer } from '@/components/layout/footer'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ArrowRight, Code2, Shield, Zap, Database } from 'lucide-react'

export const metadata: Metadata = {
    title: 'API v1 Documentation - Robota',
    description: 'Complete API documentation for Robota v1. Build powerful AI applications with our comprehensive REST API.',
}

const endpoints = [
    {
        category: 'Authentication',
        icon: Shield,
        endpoints: [
            {
                method: 'GET',
                path: '/api/v1/health',
                description: 'Health check endpoint',
                auth: false,
            }
        ]
    },
    {
        category: 'User Management',
        icon: Database,
        endpoints: [
            {
                method: 'GET',
                path: '/api/v1/user/profile',
                description: 'Get current user profile',
                auth: true,
            },
            {
                method: 'PUT',
                path: '/api/v1/user/profile',
                description: 'Update user profile',
                auth: true,
            },
            {
                method: 'GET',
                path: '/api/v1/user/credits',
                description: 'Get user credit balance and usage',
                auth: true,
            },
            {
                method: 'GET',
                path: '/api/v1/user/transactions',
                description: 'Get credit transaction history',
                auth: true,
            }
        ]
    },
    {
        category: 'AI Agents',
        icon: Zap,
        endpoints: [
            {
                method: 'POST',
                path: '/api/v1/agents/run',
                description: 'Execute AI agent with input',
                auth: true,
                cost: 2,
            },
            {
                method: 'POST',
                path: '/api/v1/tools/execute',
                description: 'Execute specific tool',
                auth: true,
                cost: 1,
            }
        ]
    },
    {
        category: 'Agents',
        icon: Code2,
        endpoints: [
            {
                method: 'GET',
                path: '/api/v1/agents',
                description: 'List all agents',
                auth: true,
            },
            {
                method: 'POST',
                path: '/api/v1/agents/create',
                description: 'Create new agent',
                auth: true,
                cost: 5,
            },
            {
                method: 'GET',
                path: '/api/v1/agents/{agentId}',
                description: 'Get agent details',
                auth: true,
            },
            {
                method: 'PUT',
                path: '/api/v1/agents/{agentId}',
                description: 'Update agent',
                auth: true,
            },
            {
                method: 'DELETE',
                path: '/api/v1/agents/{agentId}',
                description: 'Delete agent',
                auth: true,
            },
            {
                method: 'POST',
                path: '/api/v1/agents/{agentId}/run',
                description: 'Run agent',
                auth: true,
                cost: 2,
            }
        ]
    }
]

const methodColors = {
    GET: 'bg-green-500 text-white',
    POST: 'bg-blue-500 text-white',
    PUT: 'bg-yellow-500 text-white',
    DELETE: 'bg-red-500 text-white',
}

export default function ApiV1Page() {
    return (
        <div className="min-h-screen flex flex-col">
            <Header />
            <main className="flex-1">
                {/* Hero Section */}
                <section className="relative overflow-hidden bg-background py-20 sm:py-32">
                    <div className="container mx-auto px-4 sm:px-6 lg:px-8">
                        <div className="mx-auto max-w-2xl text-center">
                            <Badge className="mb-4" variant="secondary">API v1</Badge>
                            <h1 className="text-4xl font-bold tracking-tight sm:text-6xl mb-6">
                                Robota REST API
                            </h1>
                            <p className="text-xl text-muted-foreground mb-8">
                                Build powerful AI applications with our comprehensive REST API.
                                All endpoints use JSON for requests and responses.
                            </p>
                            <div className="flex gap-4 justify-center">
                                <Button asChild size="lg">
                                    <Link href="/docs/api">
                                        View Full Documentation
                                        <ArrowRight className="ml-2 h-5 w-5" />
                                    </Link>
                                </Button>
                                <Button asChild variant="outline" size="lg">
                                    <Link href="/playground">
                                        Try Playground
                                    </Link>
                                </Button>
                            </div>
                        </div>
                    </div>
                </section>

                {/* Base URL */}
                <section className="py-12 bg-muted/50">
                    <div className="container mx-auto px-4 sm:px-6 lg:px-8">
                        <Card>
                            <CardHeader>
                                <CardTitle>Base URL</CardTitle>
                                <CardDescription>All API requests should be made to:</CardDescription>
                            </CardHeader>
                            <CardContent>
                                <code className="block p-4 bg-background rounded-lg font-mono text-sm">
                                    https://robota.ai/api/v1
                                </code>
                            </CardContent>
                        </Card>
                    </div>
                </section>

                {/* Authentication */}
                <section className="py-12">
                    <div className="container mx-auto px-4 sm:px-6 lg:px-8">
                        <Card>
                            <CardHeader>
                                <CardTitle>Authentication</CardTitle>
                                <CardDescription>
                                    All authenticated endpoints require a Bearer token in the Authorization header
                                </CardDescription>
                            </CardHeader>
                            <CardContent>
                                <Tabs defaultValue="curl" className="w-full">
                                    <TabsList>
                                        <TabsTrigger value="curl">cURL</TabsTrigger>
                                        <TabsTrigger value="javascript">JavaScript</TabsTrigger>
                                        <TabsTrigger value="python">Python</TabsTrigger>
                                    </TabsList>
                                    <TabsContent value="curl" className="mt-4">
                                        <pre className="p-4 bg-muted rounded-lg overflow-x-auto">
                                            <code className="text-sm">{`curl -H "Authorization: Bearer YOUR_TOKEN" \\
  https://robota.ai/api/v1/user/profile`}</code>
                                        </pre>
                                    </TabsContent>
                                    <TabsContent value="javascript" className="mt-4">
                                        <pre className="p-4 bg-muted rounded-lg overflow-x-auto">
                                            <code className="text-sm">{`const response = await fetch('https://robota.ai/api/v1/user/profile', {
  headers: {
    'Authorization': 'Bearer YOUR_TOKEN',
    'Content-Type': 'application/json'
  }
});`}</code>
                                        </pre>
                                    </TabsContent>
                                    <TabsContent value="python" className="mt-4">
                                        <pre className="p-4 bg-muted rounded-lg overflow-x-auto">
                                            <code className="text-sm">{`import requests

response = requests.get(
    'https://robota.ai/api/v1/user/profile',
    headers={
        'Authorization': 'Bearer YOUR_TOKEN',
        'Content-Type': 'application/json'
    }
)`}</code>
                                        </pre>
                                    </TabsContent>
                                </Tabs>
                            </CardContent>
                        </Card>
                    </div>
                </section>

                {/* Endpoints */}
                <section className="py-12 bg-muted/50">
                    <div className="container mx-auto px-4 sm:px-6 lg:px-8">
                        <h2 className="text-3xl font-bold mb-8">API Endpoints</h2>
                        <div className="space-y-8">
                            {endpoints.map((category) => {
                                const Icon = category.icon;
                                return (
                                    <Card key={category.category}>
                                        <CardHeader>
                                            <CardTitle className="flex items-center gap-2">
                                                <Icon className="h-5 w-5" />
                                                {category.category}
                                            </CardTitle>
                                        </CardHeader>
                                        <CardContent>
                                            <div className="space-y-3">
                                                {category.endpoints.map((endpoint, idx) => (
                                                    <div
                                                        key={idx}
                                                        className="flex items-center justify-between p-4 bg-background rounded-lg hover:bg-muted/50 transition-colors"
                                                    >
                                                        <div className="flex items-center gap-4">
                                                            <Badge
                                                                variant="secondary"
                                                                className={methodColors[endpoint.method as keyof typeof methodColors]}
                                                            >
                                                                {endpoint.method}
                                                            </Badge>
                                                            <code className="font-mono text-sm">{endpoint.path}</code>
                                                        </div>
                                                        <div className="flex items-center gap-4">
                                                            <span className="text-sm text-muted-foreground">
                                                                {endpoint.description}
                                                            </span>
                                                            {endpoint.auth && (
                                                                <Badge variant="outline">Auth Required</Badge>
                                                            )}
                                                            {endpoint.cost && (
                                                                <Badge variant="secondary">
                                                                    {endpoint.cost} credit{endpoint.cost > 1 ? 's' : ''}
                                                                </Badge>
                                                            )}
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        </CardContent>
                                    </Card>
                                );
                            })}
                        </div>
                    </div>
                </section>

                {/* Rate Limiting */}
                <section className="py-12">
                    <div className="container mx-auto px-4 sm:px-6 lg:px-8">
                        <Card>
                            <CardHeader>
                                <CardTitle>Rate Limiting</CardTitle>
                                <CardDescription>
                                    API requests are rate limited to ensure fair usage
                                </CardDescription>
                            </CardHeader>
                            <CardContent>
                                <div className="grid gap-4 md:grid-cols-2">
                                    <div>
                                        <h4 className="font-semibold mb-2">Default Limits</h4>
                                        <ul className="space-y-1 text-sm text-muted-foreground">
                                            <li>• 100 requests per minute</li>
                                            <li>• 1,000 requests per hour</li>
                                            <li>• 10,000 requests per day</li>
                                        </ul>
                                    </div>
                                    <div>
                                        <h4 className="font-semibold mb-2">Response Headers</h4>
                                        <ul className="space-y-1 text-sm text-muted-foreground">
                                            <li>• X-RateLimit-Limit</li>
                                            <li>• X-RateLimit-Remaining</li>
                                            <li>• X-RateLimit-Reset</li>
                                        </ul>
                                    </div>
                                </div>
                            </CardContent>
                        </Card>
                    </div>
                </section>
            </main>
            <Footer />
        </div>
    )
} 