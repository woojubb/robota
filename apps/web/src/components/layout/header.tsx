'use client'

import * as React from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Menu } from 'lucide-react'

import { cn } from '@/lib/utils'
import { Logo } from '@/components/ui/logo'
import { Button } from '@/components/ui/button'
import { ThemeToggle } from '@/components/ui/theme-toggle'
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet'
import { NAVIGATION } from '@/config/brand'

export function Header() {
    const pathname = usePathname()
    const [open, setOpen] = React.useState(false)

    const NavItems = () => (
        <>
            {NAVIGATION.main.map((item) => (
                <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setOpen(false)}
                    className={cn(
                        'text-sm font-medium transition-colors hover:text-primary',
                        pathname === item.href
                            ? 'text-foreground'
                            : 'text-muted-foreground'
                    )}
                >
                    {item.title}
                </Link>
            ))}
        </>
    )

    return (
        <header className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
            <div className="container flex h-16 max-w-screen-2xl items-center">
                {/* Logo */}
                <Link href="/" className="mr-6 flex items-center space-x-2">
                    <Logo size="md" />
                </Link>

                {/* Desktop Navigation */}
                <nav className="hidden md:flex items-center space-x-6 text-sm font-medium">
                    <NavItems />
                </nav>

                {/* Right side */}
                <div className="flex flex-1 items-center justify-end space-x-2">
                    {/* Desktop CTA Buttons */}
                    <div className="hidden md:flex items-center space-x-2">
                        <Button variant="ghost" size="sm" asChild>
                            <Link href="/login">Sign In</Link>
                        </Button>
                        <Button size="sm" asChild>
                            <Link href="/signup">Get Started</Link>
                        </Button>
                    </div>

                    {/* Theme Toggle */}
                    <ThemeToggle />

                    {/* Mobile Menu */}
                    <Sheet open={open} onOpenChange={setOpen}>
                        <SheetTrigger asChild>
                            <Button
                                variant="ghost"
                                size="icon"
                                className="md:hidden"
                            >
                                <Menu className="h-5 w-5" />
                                <span className="sr-only">Toggle Menu</span>
                            </Button>
                        </SheetTrigger>
                        <SheetContent side="right" className="w-full max-w-sm">
                            <div className="grid gap-6 p-6">
                                {/* Mobile Logo */}
                                <Link
                                    href="/"
                                    onClick={() => setOpen(false)}
                                    className="flex items-center space-x-2"
                                >
                                    <Logo size="md" />
                                </Link>

                                {/* Mobile Navigation */}
                                <nav className="grid gap-4">
                                    <NavItems />
                                </nav>

                                {/* Mobile CTA Buttons */}
                                <div className="grid gap-2">
                                    <Button variant="ghost" asChild>
                                        <Link href="/login" onClick={() => setOpen(false)}>
                                            Sign In
                                        </Link>
                                    </Button>
                                    <Button asChild>
                                        <Link href="/signup" onClick={() => setOpen(false)}>
                                            Get Started
                                        </Link>
                                    </Button>
                                </div>
                            </div>
                        </SheetContent>
                    </Sheet>
                </div>
            </div>
        </header>
    )
} 