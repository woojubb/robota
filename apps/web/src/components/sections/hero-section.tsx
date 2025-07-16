import Link from 'next/link'
import { ArrowRight, Code2, Zap, Users } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { BRAND, FEATURES } from '@/config/brand'

export function HeroSection() {
    return (
        <section className="relative overflow-hidden pt-20 pb-16 sm:pt-32 sm:pb-24">
            {/* Background gradient */}
            <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-transparent to-accent/5" />

            <div className="container relative">
                <div className="mx-auto max-w-7xl text-center">
                    {/* Badge */}
                    <Badge variant="secondary" className="mb-6">
                        🚀 Now supporting GPT-4, Claude 3, and Gemini Pro
                    </Badge>

                    {/* Main heading */}
                    <h1 className="text-4xl font-bold tracking-tight text-foreground sm:text-6xl lg:text-7xl">
                        Build AI Agents with{' '}
                        <span className="bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
                            Confidence
                        </span>
                    </h1>

                    {/* Subtitle */}
                    <p className="mx-auto mt-6 max-w-2xl text-lg text-muted-foreground sm:text-xl lg:text-2xl">
                        {BRAND.description}
                    </p>

                    {/* CTA Buttons */}
                    <div className="mt-10 flex flex-col sm:flex-row gap-4 justify-center">
                        <Button size="lg" className="text-lg px-8 py-6" asChild>
                            <Link href="/playground">
                                Try Playground
                                <ArrowRight className="ml-2 h-5 w-5" />
                            </Link>
                        </Button>
                        <Button size="lg" variant="outline" className="text-lg px-8 py-6" asChild>
                            <Link href="/docs">
                                View Documentation
                            </Link>
                        </Button>
                    </div>

                    {/* Social proof */}
                    <div className="mt-12 text-center">
                        <p className="text-sm text-muted-foreground mb-6">
                            Trusted by developers at leading companies
                        </p>
                        <div className="flex flex-wrap justify-center gap-8 opacity-60">
                            {/* Company logos placeholder */}
                            <div className="text-lg font-semibold text-muted-foreground">OpenAI</div>
                            <div className="text-lg font-semibold text-muted-foreground">Anthropic</div>
                            <div className="text-lg font-semibold text-muted-foreground">Google</div>
                            <div className="text-lg font-semibold text-muted-foreground">Microsoft</div>
                        </div>
                    </div>
                </div>

                {/* Feature cards */}
                <div className="mx-auto mt-24 max-w-6xl grid gap-8 md:grid-cols-3">
                    {FEATURES.hero.map((feature, index) => {
                        const Icon = feature.icon === 'Code' ? Code2 : feature.icon === 'Zap' ? Zap : Users

                        return (
                            <div
                                key={index}
                                className="relative group"
                            >
                                <div className="relative rounded-2xl border bg-card p-8 transition-all hover:shadow-lg hover:shadow-primary/5">
                                    <div className="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-lg bg-primary/10">
                                        <Icon className="h-6 w-6 text-primary" />
                                    </div>
                                    <h3 className="text-xl font-semibold mb-3">{feature.title}</h3>
                                    <p className="text-muted-foreground">{feature.description}</p>
                                </div>
                            </div>
                        )
                    })}
                </div>
            </div>
        </section>
    )
} 