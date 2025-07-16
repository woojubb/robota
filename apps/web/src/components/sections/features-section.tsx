import { Check, Code2, Zap, Users } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { FEATURES } from '@/config/brand'

export function FeaturesSection() {
    return (
        <section className="py-24 bg-muted/30">
            <div className="container">
                <div className="mx-auto max-w-4xl text-center mb-16">
                    <Badge variant="secondary" className="mb-4">
                        Features
                    </Badge>
                    <h2 className="text-3xl font-bold tracking-tight sm:text-4xl lg:text-5xl mb-6">
                        Everything you need to build{' '}
                        <span className="bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
                            AI agents
                        </span>
                    </h2>
                    <p className="text-xl text-muted-foreground">
                        From rapid prototyping to production deployment, Robota provides all the tools
                        and infrastructure you need to build world-class AI applications.
                    </p>
                </div>

                <div className="grid gap-8 md:grid-cols-3 mb-16">
                    {FEATURES.detailed.map((feature, index) => {
                        const Icon = index === 0 ? Code2 : index === 1 ? Zap : Users

                        return (
                            <Card key={index} className="relative overflow-hidden">
                                <CardHeader>
                                    <div className="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-lg bg-primary/10">
                                        <Icon className="h-6 w-6 text-primary" />
                                    </div>
                                    <CardTitle className="text-xl">{feature.title}</CardTitle>
                                    <CardDescription className="text-base">
                                        {feature.description}
                                    </CardDescription>
                                </CardHeader>
                                <CardContent>
                                    <ul className="space-y-3">
                                        {feature.features.map((item, itemIndex) => (
                                            <li key={itemIndex} className="flex items-start gap-3">
                                                <Check className="h-5 w-5 text-primary mt-0.5 flex-shrink-0" />
                                                <span className="text-sm text-muted-foreground">{item}</span>
                                            </li>
                                        ))}
                                    </ul>
                                </CardContent>
                            </Card>
                        )
                    })}
                </div>

                {/* Stats Section */}
                <div className="grid gap-8 md:grid-cols-4 text-center">
                    <div>
                        <div className="text-3xl font-bold text-primary mb-2">50K+</div>
                        <div className="text-sm text-muted-foreground">Developers</div>
                    </div>
                    <div>
                        <div className="text-3xl font-bold text-primary mb-2">1M+</div>
                        <div className="text-sm text-muted-foreground">API Calls</div>
                    </div>
                    <div>
                        <div className="text-3xl font-bold text-primary mb-2">99.9%</div>
                        <div className="text-sm text-muted-foreground">Uptime</div>
                    </div>
                    <div>
                        <div className="text-3xl font-bold text-primary mb-2">24/7</div>
                        <div className="text-sm text-muted-foreground">Support</div>
                    </div>
                </div>
            </div>
        </section>
    )
} 