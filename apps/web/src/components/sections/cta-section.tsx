import Link from 'next/link'
import { ArrowRight, Sparkles } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'

export function CTASection() {
    return (
        <section className="py-24 bg-gradient-to-b from-background to-muted/30">
            <div className="container">
                <div className="mx-auto max-w-4xl text-center">
                    {/* Decorative element */}
                    <div className="mb-8 flex justify-center">
                        <div className="relative">
                            <div className="absolute inset-0 bg-gradient-to-r from-primary to-accent blur-3xl opacity-30" />
                            <Sparkles className="relative h-12 w-12 text-primary" />
                        </div>
                    </div>

                    {/* Badge */}
                    <Badge variant="secondary" className="mb-6">
                        Ready to get started?
                    </Badge>

                    {/* Main heading */}
                    <h2 className="text-3xl font-bold tracking-tight sm:text-4xl lg:text-5xl mb-6">
                        Start building AI agents{' '}
                        <span className="bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
                            today
                        </span>
                    </h2>

                    {/* Description */}
                    <p className="text-xl text-muted-foreground mb-10 max-w-2xl mx-auto">
                        Join thousands of developers who are already building the future with Robota.
                        Get started for free and scale as you grow.
                    </p>

                    {/* CTA Buttons */}
                    <div className="flex flex-col sm:flex-row gap-4 justify-center mb-12">
                        <Button size="lg" className="text-lg px-8 py-6" asChild>
                            <Link href="/playground">
                                Try Playground Now
                                <ArrowRight className="ml-2 h-5 w-5" />
                            </Link>
                        </Button>
                        <Button size="lg" variant="outline" className="text-lg px-8 py-6" asChild>
                            <Link href="/docs">
                                Read Documentation
                            </Link>
                        </Button>
                    </div>

                    {/* Features list */}
                    <div className="grid gap-4 md:grid-cols-3 text-sm text-muted-foreground">
                        <div className="flex items-center justify-center gap-2">
                            <div className="h-2 w-2 rounded-full bg-primary" />
                            No credit card required
                        </div>
                        <div className="flex items-center justify-center gap-2">
                            <div className="h-2 w-2 rounded-full bg-primary" />
                            Free tier available
                        </div>
                        <div className="flex items-center justify-center gap-2">
                            <div className="h-2 w-2 rounded-full bg-primary" />
                            Cancel anytime
                        </div>
                    </div>
                </div>
            </div>
        </section>
    )
} 