import Link from 'next/link'
import { Header } from '@/components/layout/header'
import { Footer } from '@/components/layout/footer'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { ArrowLeft, Home, Search } from 'lucide-react'

export default function NotFound() {
    return (
        <div className="min-h-screen flex flex-col">
            <Header />
            <main className="flex-1 flex items-center justify-center py-20">
                <div className="container">
                    <div className="mx-auto max-w-2xl text-center">
                        {/* 404 Visual */}
                        <div className="mb-8">
                            <div className="text-8xl font-bold bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
                                404
                            </div>
                            <div className="mt-4 text-2xl font-semibold text-muted-foreground">
                                Page Not Found
                            </div>
                        </div>

                        <Card>
                            <CardHeader>
                                <CardTitle className="text-xl">Oops! This page doesn't exist</CardTitle>
                                <CardDescription className="text-base">
                                    The page you're looking for might have been moved, deleted, or you might have typed the wrong URL.
                                </CardDescription>
                            </CardHeader>
                            <CardContent className="space-y-6">
                                {/* Quick Actions */}
                                <div className="flex flex-col sm:flex-row gap-4 justify-center">
                                    <Button asChild>
                                        <Link href="/">
                                            <Home className="w-4 h-4 mr-2" />
                                            Go Home
                                        </Link>
                                    </Button>
                                    <Button variant="outline" asChild>
                                        <Link href="/docs">
                                            <Search className="w-4 h-4 mr-2" />
                                            Browse Docs
                                        </Link>
                                    </Button>
                                </div>

                                {/* Helpful Links */}
                                <div className="border-t pt-6">
                                    <h3 className="text-lg font-semibold mb-4">Popular pages you might be looking for:</h3>
                                    <div className="grid gap-3 text-left">
                                        <Link
                                            href="/playground"
                                            className="flex items-center text-sm text-muted-foreground hover:text-foreground transition-colors"
                                        >
                                            <ArrowLeft className="w-3 h-3 mr-2" />
                                            Playground - Try Robota in your browser
                                        </Link>
                                        <Link
                                            href="/pricing"
                                            className="flex items-center text-sm text-muted-foreground hover:text-foreground transition-colors"
                                        >
                                            <ArrowLeft className="w-3 h-3 mr-2" />
                                            Pricing - View our plans
                                        </Link>
                                        <Link
                                            href="/about"
                                            className="flex items-center text-sm text-muted-foreground hover:text-foreground transition-colors"
                                        >
                                            <ArrowLeft className="w-3 h-3 mr-2" />
                                            About - Learn more about Robota
                                        </Link>
                                        <Link
                                            href="/contact"
                                            className="flex items-center text-sm text-muted-foreground hover:text-foreground transition-colors"
                                        >
                                            <ArrowLeft className="w-3 h-3 mr-2" />
                                            Contact - Get in touch with us
                                        </Link>
                                    </div>
                                </div>

                                {/* Help Text */}
                                <div className="border-t pt-6 text-sm text-muted-foreground">
                                    <p>
                                        If you think this is a mistake or need help, please{' '}
                                        <Link href="/contact" className="text-primary hover:underline">
                                            contact our support team
                                        </Link>
                                        .
                                    </p>
                                </div>
                            </CardContent>
                        </Card>
                    </div>
                </div>
            </main>
            <Footer />
        </div>
    )
} 