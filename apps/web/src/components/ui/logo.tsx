import * as React from 'react'
import { cn } from '@/lib/utils'

interface LogoProps {
    className?: string
    size?: 'sm' | 'md' | 'lg' | 'xl'
    variant?: 'full' | 'icon' | 'text'
}

const Logo = React.forwardRef<HTMLDivElement, LogoProps>(
    ({ className, size = 'md', variant = 'full', ...props }, ref) => {
        const sizeClasses = {
            sm: 'h-6',
            md: 'h-8',
            lg: 'h-10',
            xl: 'h-12'
        }

        const IconLogo = () => (
            <div className={cn('flex items-center justify-center rounded-lg bg-primary', sizeClasses[size])}>
                <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    className="h-3/4 w-3/4 text-primary-foreground"
                    xmlns="http://www.w3.org/2000/svg"
                >
                    {/* Robot head design */}
                    <path
                        d="M8 2h8v2h2v4h-2v10h-2v2h-8v-2h-2v-10h-2v-4h2v-2z"
                        fill="currentColor"
                        className="opacity-90"
                    />
                    {/* Eyes */}
                    <circle cx="10" cy="8" r="1.5" fill="currentColor" className="opacity-60" />
                    <circle cx="14" cy="8" r="1.5" fill="currentColor" className="opacity-60" />
                    {/* Mouth */}
                    <rect x="9" y="12" width="6" height="1" rx="0.5" fill="currentColor" className="opacity-60" />
                    {/* Antenna */}
                    <circle cx="12" cy="2" r="1" fill="currentColor" />
                </svg>
            </div>
        )

        const TextLogo = () => (
            <span
                className={cn(
                    'font-bold text-foreground tracking-tight',
                    {
                        'text-lg': size === 'sm',
                        'text-xl': size === 'md',
                        'text-2xl': size === 'lg',
                        'text-3xl': size === 'xl'
                    }
                )}
            >
                Robota
            </span>
        )

        return (
            <div
                ref={ref}
                className={cn('flex items-center gap-2', className)}
                {...props}
            >
                {(variant === 'full' || variant === 'icon') && <IconLogo />}
                {(variant === 'full' || variant === 'text') && <TextLogo />}
            </div>
        )
    }
)

Logo.displayName = 'Logo'

export { Logo } 