import Link from 'next/link'
import { Github, Twitter, MessageCircle } from 'lucide-react'

import { Logo } from '@/components/ui/logo'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { NAVIGATION, SITE, BRAND } from '@/config/brand'

export function Footer() {
    const currentYear = new Date().getFullYear()

    return (
        <footer className="border-t bg-background">
            <div className="container py-16">
                <div className="grid gap-8 lg:grid-cols-5">
                    {/* Brand Column */}
                    <div className="lg:col-span-2">
                        <Link href="/" className="flex items-center space-x-2 mb-4">
                            <Logo size="lg" />
                        </Link>
                        <p className="text-muted-foreground mb-6 max-w-md">
                            {BRAND.description}
                        </p>
                        <div className="flex space-x-4">
                            <Button variant="ghost" size="icon" asChild>
                                <Link href={SITE.social.github} target="_blank" rel="noopener noreferrer">
                                    <Github className="h-5 w-5" />
                                    <span className="sr-only">GitHub</span>
                                </Link>
                            </Button>
                            <Button variant="ghost" size="icon" asChild>
                                <Link href={SITE.social.twitter} target="_blank" rel="noopener noreferrer">
                                    <Twitter className="h-5 w-5" />
                                    <span className="sr-only">Twitter</span>
                                </Link>
                            </Button>
                            <Button variant="ghost" size="icon" asChild>
                                <Link href={SITE.social.discord} target="_blank" rel="noopener noreferrer">
                                    <MessageCircle className="h-5 w-5" />
                                    <span className="sr-only">Discord</span>
                                </Link>
                            </Button>
                        </div>
                    </div>

                    {/* Navigation Columns */}
                    {NAVIGATION.footer.map((section) => (
                        <div key={section.title}>
                            <h3 className="font-semibold mb-4">{section.title}</h3>
                            <ul className="space-y-3">
                                {section.items.map((item) => (
                                    <li key={item.href}>
                                        <Link
                                            href={item.href}
                                            className="text-sm text-muted-foreground hover:text-foreground transition-colors"
                                            target={'external' in item && item.external ? '_blank' : undefined}
                                            rel={'external' in item && item.external ? 'noopener noreferrer' : undefined}
                                        >
                                            {item.title}
                                        </Link>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    ))}
                </div>

                <Separator className="my-8" />

                {/* Bottom Row */}
                <div className="flex flex-col md:flex-row justify-between items-center gap-4">
                    <div className="flex flex-col md:flex-row items-center gap-4 text-sm text-muted-foreground">
                        <p>© {currentYear} {BRAND.name}. All rights reserved.</p>
                        <div className="flex items-center gap-4">
                            <Link href="/privacy" className="hover:text-foreground transition-colors">
                                Privacy Policy
                            </Link>
                            <Link href="/terms" className="hover:text-foreground transition-colors">
                                Terms of Service
                            </Link>
                        </div>
                    </div>
                    <p className="text-sm text-muted-foreground">
                        Made with ❤️ for AI developers
                    </p>
                </div>
            </div>
        </footer>
    )
} 