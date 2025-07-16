import type { Metadata } from 'next'
import { Header } from '@/components/layout/header'
import { Footer } from '@/components/layout/footer'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Users, Target, Lightbulb, Heart } from 'lucide-react'

export const metadata: Metadata = {
    title: 'About Us - Robota',
    description: 'Learn about Robota\'s mission to democratize AI agent development and make artificial intelligence accessible to all developers.',
}

const teamMembers = [
    {
        name: 'Alex Chen',
        role: 'CEO & Co-founder',
        description: 'Former AI researcher at Google, passionate about democratizing AI technology.',
        avatar: '/avatars/alex.jpg'
    },
    {
        name: 'Sarah Kim',
        role: 'CTO & Co-founder',
        description: 'Ex-OpenAI engineer with 10+ years in machine learning and distributed systems.',
        avatar: '/avatars/sarah.jpg'
    },
    {
        name: 'David Park',
        role: 'Head of Engineering',
        description: 'Previously led engineering teams at Anthropic, expert in AI safety and scalability.',
        avatar: '/avatars/david.jpg'
    },
    {
        name: 'Maria Rodriguez',
        role: 'Head of Design',
        description: 'Award-winning UX designer focused on making complex technology intuitive.',
        avatar: '/avatars/maria.jpg'
    }
]

const values = [
    {
        icon: Users,
        title: 'Developer First',
        description: 'We build tools by developers, for developers. Every decision is made with the developer experience in mind.'
    },
    {
        icon: Target,
        title: 'Simplicity',
        description: 'Complex AI should be simple to use. We hide the complexity so you can focus on building amazing products.'
    },
    {
        icon: Lightbulb,
        title: 'Innovation',
        description: 'We constantly push the boundaries of what\'s possible with AI, bringing cutting-edge research to production.'
    },
    {
        icon: Heart,
        title: 'Community',
        description: 'Open source at heart, we believe in building together and sharing knowledge with the global developer community.'
    }
]

export default function AboutPage() {
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
                                About Robota
                            </Badge>

                            <h1 className="text-4xl font-bold tracking-tight text-foreground sm:text-6xl lg:text-7xl mb-6">
                                Building the future of{' '}
                                <span className="bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
                                    AI development
                                </span>
                            </h1>

                            <p className="text-xl text-muted-foreground max-w-3xl mx-auto">
                                We believe that powerful AI should be accessible to every developer.
                                Our mission is to democratize artificial intelligence by providing
                                the tools, infrastructure, and community needed to build the next
                                generation of intelligent applications.
                            </p>
                        </div>
                    </div>
                </section>

                {/* Mission Section */}
                <section className="py-24 bg-muted/30">
                    <div className="container">
                        <div className="mx-auto max-w-4xl">
                            <div className="text-center mb-16">
                                <h2 className="text-3xl font-bold tracking-tight sm:text-4xl mb-6">
                                    Our Mission
                                </h2>
                                <p className="text-xl text-muted-foreground">
                                    To make AI agent development as simple as building a web application
                                </p>
                            </div>

                            <div className="grid gap-8 md:grid-cols-2">
                                <Card>
                                    <CardHeader>
                                        <CardTitle className="text-xl">The Problem</CardTitle>
                                    </CardHeader>
                                    <CardContent>
                                        <p className="text-muted-foreground">
                                            Building AI agents today requires deep expertise in machine learning,
                                            complex infrastructure setup, and managing multiple provider APIs.
                                            This creates barriers that prevent many talented developers from
                                            building innovative AI applications.
                                        </p>
                                    </CardContent>
                                </Card>

                                <Card>
                                    <CardHeader>
                                        <CardTitle className="text-xl">Our Solution</CardTitle>
                                    </CardHeader>
                                    <CardContent>
                                        <p className="text-muted-foreground">
                                            Robota provides a unified SDK and platform that abstracts away
                                            the complexity of AI development. With just a few lines of code,
                                            developers can create sophisticated AI agents that work across
                                            multiple providers and scale effortlessly.
                                        </p>
                                    </CardContent>
                                </Card>
                            </div>
                        </div>
                    </div>
                </section>

                {/* Values Section */}
                <section className="py-24">
                    <div className="container">
                        <div className="mx-auto max-w-4xl text-center mb-16">
                            <h2 className="text-3xl font-bold tracking-tight sm:text-4xl mb-6">
                                Our Values
                            </h2>
                            <p className="text-xl text-muted-foreground">
                                The principles that guide everything we do
                            </p>
                        </div>

                        <div className="grid gap-8 md:grid-cols-2 lg:grid-cols-4">
                            {values.map((value, index) => {
                                const Icon = value.icon
                                return (
                                    <Card key={index} className="text-center">
                                        <CardHeader>
                                            <div className="mx-auto mb-4 inline-flex h-12 w-12 items-center justify-center rounded-lg bg-primary/10">
                                                <Icon className="h-6 w-6 text-primary" />
                                            </div>
                                            <CardTitle className="text-lg">{value.title}</CardTitle>
                                        </CardHeader>
                                        <CardContent>
                                            <p className="text-sm text-muted-foreground">{value.description}</p>
                                        </CardContent>
                                    </Card>
                                )
                            })}
                        </div>
                    </div>
                </section>

                {/* Team Section */}
                <section className="py-24 bg-muted/30">
                    <div className="container">
                        <div className="mx-auto max-w-4xl text-center mb-16">
                            <h2 className="text-3xl font-bold tracking-tight sm:text-4xl mb-6">
                                Meet Our Team
                            </h2>
                            <p className="text-xl text-muted-foreground">
                                Passionate individuals from world-class AI companies
                            </p>
                        </div>

                        <div className="grid gap-8 md:grid-cols-2 lg:grid-cols-4">
                            {teamMembers.map((member, index) => (
                                <Card key={index} className="text-center">
                                    <CardHeader>
                                        <div className="mx-auto mb-4 h-20 w-20 rounded-full bg-gradient-to-br from-primary to-accent" />
                                        <CardTitle className="text-lg">{member.name}</CardTitle>
                                        <CardDescription className="text-primary font-medium">
                                            {member.role}
                                        </CardDescription>
                                    </CardHeader>
                                    <CardContent>
                                        <p className="text-sm text-muted-foreground">{member.description}</p>
                                    </CardContent>
                                </Card>
                            ))}
                        </div>
                    </div>
                </section>

                {/* Journey Section */}
                <section className="py-24">
                    <div className="container">
                        <div className="mx-auto max-w-4xl">
                            <div className="text-center mb-16">
                                <h2 className="text-3xl font-bold tracking-tight sm:text-4xl mb-6">
                                    Our Journey
                                </h2>
                                <p className="text-xl text-muted-foreground">
                                    From idea to impact
                                </p>
                            </div>

                            <div className="space-y-8">
                                <div className="flex gap-6 items-start">
                                    <div className="flex-shrink-0 w-12 h-12 rounded-full bg-primary text-primary-foreground flex items-center justify-center font-bold">
                                        2023
                                    </div>
                                    <div>
                                        <h3 className="text-xl font-semibold mb-2">The Beginning</h3>
                                        <p className="text-muted-foreground">
                                            Founded by AI researchers frustrated with the complexity of building
                                            production-ready AI applications. Started as an open-source project
                                            to simplify multi-provider AI integration.
                                        </p>
                                    </div>
                                </div>

                                <div className="flex gap-6 items-start">
                                    <div className="flex-shrink-0 w-12 h-12 rounded-full bg-primary text-primary-foreground flex items-center justify-center font-bold">
                                        2024
                                    </div>
                                    <div>
                                        <h3 className="text-xl font-semibold mb-2">Growing Community</h3>
                                        <p className="text-muted-foreground">
                                            Reached 50,000+ developers using Robota SDK. Launched our
                                            cloud platform to provide infrastructure and tools for
                                            building, testing, and deploying AI agents at scale.
                                        </p>
                                    </div>
                                </div>

                                <div className="flex gap-6 items-start">
                                    <div className="flex-shrink-0 w-12 h-12 rounded-full bg-accent text-accent-foreground flex items-center justify-center font-bold">
                                        2025
                                    </div>
                                    <div>
                                        <h3 className="text-xl font-semibold mb-2">The Future</h3>
                                        <p className="text-muted-foreground">
                                            Expanding to support enterprise use cases, building advanced
                                            collaboration tools, and continuing to make AI development
                                            accessible to developers worldwide.
                                        </p>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </section>
            </main>
            <Footer />
        </div>
    )
} 