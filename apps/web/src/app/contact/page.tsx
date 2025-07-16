import type { Metadata } from 'next'
import Link from 'next/link'
import { Header } from '@/components/layout/header'
import { Footer } from '@/components/layout/footer'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Mail, MessageCircle, Github, MapPin, Clock, Send } from 'lucide-react'
import { SITE } from '@/config/brand'

export const metadata: Metadata = {
    title: 'Contact Us - Robota',
    description: 'Get in touch with the Robota team. We\'re here to help with questions, support, and partnership opportunities.',
}

const contactMethods = [
    {
        icon: Mail,
        title: 'Email Support',
        description: 'General inquiries and support',
        contact: SITE.email,
        action: `mailto:${SITE.email}`
    },
    {
        icon: MessageCircle,
        title: 'Discord Community',
        description: 'Join our developer community',
        contact: 'discord.gg/robota',
        action: SITE.social.discord
    },
    {
        icon: Github,
        title: 'GitHub Issues',
        description: 'Bug reports and feature requests',
        contact: 'github.com/robota-ai/robota',
        action: SITE.social.github
    }
]

const officeInfo = [
    {
        icon: MapPin,
        title: 'Headquarters',
        details: [
            'San Francisco, CA',
            'United States'
        ]
    },
    {
        icon: Clock,
        title: 'Support Hours',
        details: [
            'Monday - Friday: 9AM - 6PM PST',
            'Weekend: Community support'
        ]
    }
]

export default function ContactPage() {
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
                                📞 Get in touch
                            </Badge>

                            <h1 className="text-4xl font-bold tracking-tight text-foreground sm:text-6xl lg:text-7xl mb-6">
                                We'd love to{' '}
                                <span className="bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
                                    hear from you
                                </span>
                            </h1>

                            <p className="text-xl text-muted-foreground max-w-3xl mx-auto">
                                Whether you have questions about Robota, need technical support,
                                or want to explore partnership opportunities, our team is here to help.
                            </p>
                        </div>
                    </div>
                </section>

                {/* Contact Methods */}
                <section className="py-24">
                    <div className="container">
                        <div className="mx-auto max-w-4xl text-center mb-16">
                            <h2 className="text-3xl font-bold tracking-tight sm:text-4xl mb-6">
                                Choose Your Preferred Way to Connect
                            </h2>
                            <p className="text-xl text-muted-foreground">
                                We're available through multiple channels to support you
                            </p>
                        </div>

                        <div className="grid gap-8 md:grid-cols-3 mb-16">
                            {contactMethods.map((method, index) => {
                                const Icon = method.icon
                                return (
                                    <Card key={index} className="text-center hover:shadow-lg transition-shadow">
                                        <CardHeader>
                                            <div className="mx-auto mb-4 inline-flex h-12 w-12 items-center justify-center rounded-lg bg-primary/10">
                                                <Icon className="h-6 w-6 text-primary" />
                                            </div>
                                            <CardTitle className="text-xl">{method.title}</CardTitle>
                                            <CardDescription className="text-base">
                                                {method.description}
                                            </CardDescription>
                                        </CardHeader>
                                        <CardContent>
                                            <p className="text-sm text-muted-foreground mb-4">{method.contact}</p>
                                            <Button asChild className="w-full">
                                                <Link href={method.action} target="_blank" rel="noopener noreferrer">
                                                    Connect Now
                                                </Link>
                                            </Button>
                                        </CardContent>
                                    </Card>
                                )
                            })}
                        </div>

                        {/* Office Info */}
                        <div className="grid gap-8 md:grid-cols-2">
                            {officeInfo.map((info, index) => {
                                const Icon = info.icon
                                return (
                                    <Card key={index}>
                                        <CardHeader>
                                            <div className="flex items-center gap-3">
                                                <div className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                                                    <Icon className="h-5 w-5 text-primary" />
                                                </div>
                                                <CardTitle className="text-lg">{info.title}</CardTitle>
                                            </div>
                                        </CardHeader>
                                        <CardContent>
                                            <ul className="space-y-2">
                                                {info.details.map((detail, detailIndex) => (
                                                    <li key={detailIndex} className="text-muted-foreground">
                                                        {detail}
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

                {/* Contact Form */}
                <section className="py-24 bg-muted/30">
                    <div className="container">
                        <div className="mx-auto max-w-2xl">
                            <div className="text-center mb-12">
                                <h2 className="text-3xl font-bold tracking-tight sm:text-4xl mb-6">
                                    Send Us a Message
                                </h2>
                                <p className="text-xl text-muted-foreground">
                                    Fill out the form below and we'll get back to you within 24 hours
                                </p>
                            </div>

                            <Card>
                                <CardHeader>
                                    <CardTitle className="text-xl">Contact Form</CardTitle>
                                    <CardDescription>
                                        We'll respond to your inquiry as soon as possible
                                    </CardDescription>
                                </CardHeader>
                                <CardContent>
                                    <form className="space-y-6">
                                        <div className="grid gap-4 md:grid-cols-2">
                                            <div className="space-y-2">
                                                <Label htmlFor="firstName">First Name</Label>
                                                <Input id="firstName" placeholder="Your first name" required />
                                            </div>
                                            <div className="space-y-2">
                                                <Label htmlFor="lastName">Last Name</Label>
                                                <Input id="lastName" placeholder="Your last name" required />
                                            </div>
                                        </div>

                                        <div className="space-y-2">
                                            <Label htmlFor="email">Email</Label>
                                            <Input id="email" type="email" placeholder="your.email@example.com" required />
                                        </div>

                                        <div className="space-y-2">
                                            <Label htmlFor="company">Company (Optional)</Label>
                                            <Input id="company" placeholder="Your company name" />
                                        </div>

                                        <div className="space-y-2">
                                            <Label htmlFor="subject">Subject</Label>
                                            <Input id="subject" placeholder="What is this regarding?" required />
                                        </div>

                                        <div className="space-y-2">
                                            <Label htmlFor="message">Message</Label>
                                            <Textarea
                                                id="message"
                                                placeholder="Tell us more about your inquiry..."
                                                className="min-h-[120px]"
                                                required
                                            />
                                        </div>

                                        <Button type="submit" className="w-full">
                                            <Send className="w-4 h-4 mr-2" />
                                            Send Message
                                        </Button>
                                    </form>
                                </CardContent>
                            </Card>
                        </div>
                    </div>
                </section>

                {/* FAQ Section */}
                <section className="py-24">
                    <div className="container">
                        <div className="mx-auto max-w-4xl text-center mb-16">
                            <h2 className="text-3xl font-bold tracking-tight sm:text-4xl mb-6">
                                Common Questions
                            </h2>
                            <p className="text-xl text-muted-foreground">
                                Quick answers to questions you might have
                            </p>
                        </div>

                        <div className="mx-auto max-w-3xl space-y-6">
                            <Card>
                                <CardHeader>
                                    <CardTitle className="text-lg text-left">How quickly do you respond to inquiries?</CardTitle>
                                </CardHeader>
                                <CardContent>
                                    <p className="text-muted-foreground">
                                        We typically respond to all inquiries within 24 hours during business days.
                                        For urgent technical issues, we recommend joining our Discord community for faster support.
                                    </p>
                                </CardContent>
                            </Card>

                            <Card>
                                <CardHeader>
                                    <CardTitle className="text-lg text-left">Do you offer enterprise support?</CardTitle>
                                </CardHeader>
                                <CardContent>
                                    <p className="text-muted-foreground">
                                        Yes! We offer dedicated enterprise support with SLA guarantees,
                                        priority response times, and direct access to our engineering team.
                                        Contact us to discuss your enterprise needs.
                                    </p>
                                </CardContent>
                            </Card>

                            <Card>
                                <CardHeader>
                                    <CardTitle className="text-lg text-left">Can you help with custom integrations?</CardTitle>
                                </CardHeader>
                                <CardContent>
                                    <p className="text-muted-foreground">
                                        Absolutely! Our team can help with custom integrations, consulting,
                                        and implementation services. We work with companies of all sizes to
                                        build tailored AI solutions.
                                    </p>
                                </CardContent>
                            </Card>

                            <Card>
                                <CardHeader>
                                    <CardTitle className="text-lg text-left">Do you offer training or workshops?</CardTitle>
                                </CardHeader>
                                <CardContent>
                                    <p className="text-muted-foreground">
                                        Yes, we offer training sessions and workshops for teams looking to
                                        get started with Robota. These can be customized to your specific
                                        use cases and technical requirements.
                                    </p>
                                </CardContent>
                            </Card>
                        </div>
                    </div>
                </section>
            </main>
            <Footer />
        </div>
    )
} 