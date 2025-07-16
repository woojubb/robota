'use client'

import * as React from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Menu, LogOut, User } from 'lucide-react'

import { cn } from '@/lib/utils'
import { Logo } from '@/components/ui/logo'
import { Button } from '@/components/ui/button'
import { ThemeToggle } from '@/components/ui/theme-toggle'
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { NAVIGATION } from '@/config/brand'
import { useAuth } from '@/contexts/auth-context'

export function Header() {
    const pathname = usePathname()
    const [open, setOpen] = React.useState(false)
    const { user, signOut, loading } = useAuth()

    const getInitials = (name: string | null) => {
        if (!name) return 'U';
        return name
            .split(' ')
            .map(word => word[0])
            .join('')
            .toUpperCase()
            .slice(0, 2);
    }

    const handleSignOut = async () => {
        try {
            await signOut();
        } catch (error) {
            console.error('Sign out error:', error);
        }
    }

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
                    {/* Desktop Auth Buttons */}
                    <div className="hidden md:flex items-center space-x-2">
                        {user ? (
                            <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                    <Button variant="ghost" className="h-8 w-8 rounded-full">
                                        <Avatar className="h-8 w-8">
                                            <AvatarImage src={user.photoURL || ''} />
                                            <AvatarFallback>
                                                {getInitials(user.displayName)}
                                            </AvatarFallback>
                                        </Avatar>
                                    </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end">
                                    <div className="flex items-center justify-start gap-2 p-2">
                                        <div className="flex flex-col space-y-1">
                                            <p className="text-sm font-medium leading-none">
                                                {user.displayName || 'Anonymous'}
                                            </p>
                                            <p className="text-xs leading-none text-muted-foreground">
                                                {user.email}
                                            </p>
                                        </div>
                                    </div>
                                    <DropdownMenuSeparator />
                                    <DropdownMenuItem asChild>
                                        <Link href="/dashboard">
                                            <User className="mr-2 h-4 w-4" />
                                            대시보드
                                        </Link>
                                    </DropdownMenuItem>
                                    <DropdownMenuItem asChild>
                                        <Link href="/playground">
                                            Playground
                                        </Link>
                                    </DropdownMenuItem>
                                    <DropdownMenuSeparator />
                                    <DropdownMenuItem onClick={handleSignOut}>
                                        <LogOut className="mr-2 h-4 w-4" />
                                        로그아웃
                                    </DropdownMenuItem>
                                </DropdownMenuContent>
                            </DropdownMenu>
                        ) : (
                            <>
                                <Button variant="ghost" size="sm" asChild>
                                    <Link href="/auth/login">로그인</Link>
                                </Button>
                                <Button size="sm" asChild>
                                    <Link href="/auth/register">시작하기</Link>
                                </Button>
                            </>
                        )}
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

                                {/* Mobile Auth Buttons */}
                                <div className="grid gap-2">
                                    {user ? (
                                        <>
                                            <div className="flex items-center gap-3 p-2 border rounded-lg">
                                                <Avatar className="h-10 w-10">
                                                    <AvatarImage src={user.photoURL || ''} />
                                                    <AvatarFallback>
                                                        {getInitials(user.displayName)}
                                                    </AvatarFallback>
                                                </Avatar>
                                                <div className="flex flex-col">
                                                    <p className="text-sm font-medium">
                                                        {user.displayName || 'Anonymous'}
                                                    </p>
                                                    <p className="text-xs text-muted-foreground">
                                                        {user.email}
                                                    </p>
                                                </div>
                                            </div>
                                            <Button variant="ghost" asChild>
                                                <Link href="/dashboard" onClick={() => setOpen(false)}>
                                                    대시보드
                                                </Link>
                                            </Button>
                                            <Button variant="ghost" asChild>
                                                <Link href="/playground" onClick={() => setOpen(false)}>
                                                    Playground
                                                </Link>
                                            </Button>
                                            <Button variant="outline" onClick={() => { handleSignOut(); setOpen(false); }}>
                                                <LogOut className="mr-2 h-4 w-4" />
                                                로그아웃
                                            </Button>
                                        </>
                                    ) : (
                                        <>
                                            <Button variant="ghost" asChild>
                                                <Link href="/auth/login" onClick={() => setOpen(false)}>
                                                    로그인
                                                </Link>
                                            </Button>
                                            <Button asChild>
                                                <Link href="/auth/register" onClick={() => setOpen(false)}>
                                                    시작하기
                                                </Link>
                                            </Button>
                                        </>
                                    )}
                                </div>
                            </div>
                        </SheetContent>
                    </Sheet>
                </div>
            </div>
        </header>
    )
} 