import type { Metadata } from 'next'
import Link from 'next/link'
import { Header } from '@/components/layout/header'
import { Footer } from '@/components/layout/footer'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Check, ArrowRight, Zap, Star } from 'lucide-react'
import { PRICING } from '@/config/brand'

export const metadata: Metadata = {
    title: 'Pricing - Robota',
    description: 'Choose the perfect plan for your AI development needs. From free tier for learning to enterprise solutions for scale.',
}

const faqs = [
    {
        question: 'Can I change my plan anytime?',
        answer: 'Yes, you can upgrade or downgrade your plan at any time. Changes take effect immediately, and billing is prorated.'
    },
    {
        question: 'What happens if I exceed my API limits?',
        answer: 'We\'ll send you notifications as you approach your limits. You can upgrade your plan or purchase additional API calls as needed.'
    },
    {
        question: 'Do you offer discounts for students or nonprofits?',
        answer: 'Yes! We offer 50% discounts for verified students and educational institutions. Contact us for nonprofit pricing.'
    },
    {
        question: 'Is there a free trial for paid plans?',
        answer: 'All paid plans come with a 14-day free trial. No credit card required to start.'
    },
    {
        question: 'What payment methods do you accept?',
        answer: 'We accept all major credit cards, PayPal, and can arrange invoicing for enterprise customers.'
    },
    {
        question: 'Can I use my own API keys?',
        answer: 'Yes! You can bring your own API keys from OpenAI, Anthropic, or Google and use them through our platform.'
    }
]

export default function PricingPage() {
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
                                💰 Simple, transparent pricing
                            </Badge>

                            <h1 className="text-4xl font-bold tracking-tight text-foreground sm:text-6xl lg:text-7xl mb-6">
                                Choose your{' '}
                                <span className="bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
                                    perfect plan
                                </span>
                            </h1>

                            <p className="text-xl text-muted-foreground max-w-3xl mx-auto mb-10">
                                Start building for free, then scale as you grow.
                                All plans include access to our playground, documentation, and community support.
                            </p>

                            <div className="flex flex-col sm:flex-row gap-4 justify-center">
                                <Button size="lg" variant="outline" asChild>
                                    <Link href="#plans">
                                        View Plans
                                        <ArrowRight className="ml-2 h-5 w-5" />
                                    </Link>
                                </Button>
                                <Button size="lg" asChild>
                                    <Link href="/playground">
                                        Try Free Now
                                    </Link>
                                </Button>
                            </div>
                        </div>
                    </div>
                </section>

                {/* Pricing Plans */}
                <section id="plans" className="py-24">
                    <div className="container">
                        <div className="grid gap-8 lg:grid-cols-4">
                            {PRICING.plans.map((plan, index) => (
                                <Card
                                    key={index}
                                    className={`relative ${plan.popular ? 'border-primary ring-2 ring-primary/20' : ''}`}
                                >
                                    {plan.popular && (
                                        <div className="absolute -top-3 left-1/2 transform -translate-x-1/2">
                                            <Badge className="bg-primary text-primary-foreground">
                                                <Star className="w-3 h-3 mr-1" />
                                                Most Popular
                                            </Badge>
                                        </div>
                                    )}

                                    <CardHeader className="text-center pb-2">
                                        <CardTitle className="text-2xl">{plan.name}</CardTitle>
                                        <CardDescription className="text-base">
                                            {plan.description}
                                        </CardDescription>
                                    </CardHeader>

                                    <CardContent className="text-center">
                                        <div className="mb-6">
                                            {plan.price === null ? (
                                                <div className="text-3xl font-bold">Custom</div>
                                            ) : plan.price === 0 ? (
                                                <div className="text-3xl font-bold">Free</div>
                                            ) : (
                                                <div className="text-3xl font-bold">
                                                    ${plan.price}
                                                    <span className="text-lg font-normal text-muted-foreground">
                                                        /{plan.period}
                                                    </span>
                                                </div>
                                            )}
                                        </div>

                                        <Button
                                            className="w-full mb-6"
                                            variant={plan.popular ? 'default' : 'outline'}
                                            asChild
                                        >
                                            <Link href={plan.name === 'Enterprise' ? '/contact' : '/signup'}>
                                                {plan.name === 'Enterprise' ? 'Contact Sales' : 'Get Started'}
                                            </Link>
                                        </Button>

                                        <ul className="space-y-3 text-left">
                                            {plan.features.map((feature, featureIndex) => (
                                                <li key={featureIndex} className="flex items-start gap-3">
                                                    <Check className="h-5 w-5 text-primary mt-0.5 flex-shrink-0" />
                                                    <span className="text-sm text-muted-foreground">{feature}</span>
                                                </li>
                                            ))}
                                        </ul>
                                    </CardContent>
                                </Card>
                            ))}
                        </div>
                    </div>
                </section>

                {/* Features Comparison */}
                <section className="py-24 bg-muted/30">
                    <div className="container">
                        <div className="mx-auto max-w-4xl text-center mb-16">
                            <h2 className="text-3xl font-bold tracking-tight sm:text-4xl mb-6">
                                Compare Plans
                            </h2>
                            <p className="text-xl text-muted-foreground">
                                See what's included in each plan
                            </p>
                        </div>

                        <div className="overflow-x-auto">
                            <table className="w-full border-collapse border border-border rounded-lg">
                                <thead>
                                    <tr className="bg-muted/50">
                                        <th className="border border-border p-4 text-left font-semibold">Feature</th>
                                        <th className="border border-border p-4 text-center font-semibold">Free</th>
                                        <th className="border border-border p-4 text-center font-semibold">Starter</th>
                                        <th className="border border-border p-4 text-center font-semibold">Pro</th>
                                        <th className="border border-border p-4 text-center font-semibold">Enterprise</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    <tr>
                                        <td className="border border-border p-4 font-medium">API Calls/Month</td>
                                        <td className="border border-border p-4 text-center">1,000</td>
                                        <td className="border border-border p-4 text-center">10,000</td>
                                        <td className="border border-border p-4 text-center">100,000</td>
                                        <td className="border border-border p-4 text-center">Unlimited</td>
                                    </tr>
                                    <tr className="bg-muted/25">
                                        <td className="border border-border p-4 font-medium">Playground Access</td>
                                        <td className="border border-border p-4 text-center">
                                            <Check className="h-5 w-5 text-primary mx-auto" />
                                        </td>
                                        <td className="border border-border p-4 text-center">
                                            <Check className="h-5 w-5 text-primary mx-auto" />
                                        </td>
                                        <td className="border border-border p-4 text-center">
                                            <Check className="h-5 w-5 text-primary mx-auto" />
                                        </td>
                                        <td className="border border-border p-4 text-center">
                                            <Check className="h-5 w-5 text-primary mx-auto" />
                                        </td>
                                    </tr>
                                    <tr>
                                        <td className="border border-border p-4 font-medium">Private Projects</td>
                                        <td className="border border-border p-4 text-center">-</td>
                                        <td className="border border-border p-4 text-center">
                                            <Check className="h-5 w-5 text-primary mx-auto" />
                                        </td>
                                        <td className="border border-border p-4 text-center">
                                            <Check className="h-5 w-5 text-primary mx-auto" />
                                        </td>
                                        <td className="border border-border p-4 text-center">
                                            <Check className="h-5 w-5 text-primary mx-auto" />
                                        </td>
                                    </tr>
                                    <tr className="bg-muted/25">
                                        <td className="border border-border p-4 font-medium">Team Collaboration</td>
                                        <td className="border border-border p-4 text-center">-</td>
                                        <td className="border border-border p-4 text-center">-</td>
                                        <td className="border border-border p-4 text-center">
                                            <Check className="h-5 w-5 text-primary mx-auto" />
                                        </td>
                                        <td className="border border-border p-4 text-center">
                                            <Check className="h-5 w-5 text-primary mx-auto" />
                                        </td>
                                    </tr>
                                    <tr>
                                        <td className="border border-border p-4 font-medium">Priority Support</td>
                                        <td className="border border-border p-4 text-center">-</td>
                                        <td className="border border-border p-4 text-center">
                                            <Check className="h-5 w-5 text-primary mx-auto" />
                                        </td>
                                        <td className="border border-border p-4 text-center">
                                            <Check className="h-5 w-5 text-primary mx-auto" />
                                        </td>
                                        <td className="border border-border p-4 text-center">
                                            <Check className="h-5 w-5 text-primary mx-auto" />
                                        </td>
                                    </tr>
                                    <tr className="bg-muted/25">
                                        <td className="border border-border p-4 font-medium">SLA Guarantee</td>
                                        <td className="border border-border p-4 text-center">-</td>
                                        <td className="border border-border p-4 text-center">-</td>
                                        <td className="border border-border p-4 text-center">99.9%</td>
                                        <td className="border border-border p-4 text-center">99.99%</td>
                                    </tr>
                                </tbody>
                            </table>
                        </div>
                    </div>
                </section>

                {/* FAQ Section */}
                <section className="py-24">
                    <div className="container">
                        <div className="mx-auto max-w-4xl text-center mb-16">
                            <h2 className="text-3xl font-bold tracking-tight sm:text-4xl mb-6">
                                Frequently Asked Questions
                            </h2>
                            <p className="text-xl text-muted-foreground">
                                Got questions? We have answers.
                            </p>
                        </div>

                        <div className="mx-auto max-w-3xl space-y-6">
                            {faqs.map((faq, index) => (
                                <Card key={index}>
                                    <CardHeader>
                                        <CardTitle className="text-lg text-left">{faq.question}</CardTitle>
                                    </CardHeader>
                                    <CardContent>
                                        <p className="text-muted-foreground">{faq.answer}</p>
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
                            <div className="mb-8 flex justify-center">
                                <div className="relative">
                                    <div className="absolute inset-0 bg-gradient-to-r from-primary to-accent blur-3xl opacity-30" />
                                    <Zap className="relative h-12 w-12 text-primary" />
                                </div>
                            </div>

                            <h2 className="text-3xl font-bold tracking-tight sm:text-4xl mb-6">
                                Ready to get started?
                            </h2>

                            <p className="text-xl text-muted-foreground mb-10 max-w-2xl mx-auto">
                                Join thousands of developers building the future with AI.
                                Start for free, no credit card required.
                            </p>

                            <div className="flex flex-col sm:flex-row gap-4 justify-center">
                                <Button size="lg" className="text-lg px-8 py-6" asChild>
                                    <Link href="/signup">
                                        Start Free Trial
                                        <ArrowRight className="ml-2 h-5 w-5" />
                                    </Link>
                                </Button>
                                <Button size="lg" variant="outline" className="text-lg px-8 py-6" asChild>
                                    <Link href="/contact">
                                        Talk to Sales
                                    </Link>
                                </Button>
                            </div>
                        </div>
                    </div>
                </section>
            </main>
            <Footer />
        </div>
    )
} 