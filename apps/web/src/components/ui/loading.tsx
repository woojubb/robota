import * as React from 'react'
import { cn } from '@/lib/utils'
import { Loader2 } from 'lucide-react'

interface LoadingProps {
    className?: string
    size?: 'sm' | 'md' | 'lg'
    variant?: 'spinner' | 'dots' | 'pulse'
    text?: string
}

const Loading = React.forwardRef<HTMLDivElement, LoadingProps>(
    ({ className, size = 'md', variant = 'spinner', text, ...props }, ref) => {
        const sizeClasses = {
            sm: 'h-4 w-4',
            md: 'h-6 w-6',
            lg: 'h-8 w-8'
        }

        const textSizeClasses = {
            sm: 'text-sm',
            md: 'text-base',
            lg: 'text-lg'
        }

        if (variant === 'spinner') {
            return (
                <div
                    ref={ref}
                    className={cn('flex items-center justify-center gap-2', className)}
                    {...props}
                >
                    <Loader2 className={cn('animate-spin text-primary', sizeClasses[size])} />
                    {text && (
                        <span className={cn('text-muted-foreground', textSizeClasses[size])}>
                            {text}
                        </span>
                    )}
                </div>
            )
        }

        if (variant === 'dots') {
            return (
                <div
                    ref={ref}
                    className={cn('flex items-center justify-center gap-2', className)}
                    {...props}
                >
                    <div className="flex space-x-1">
                        <div
                            className={cn('rounded-full bg-primary animate-bounce', {
                                'h-2 w-2': size === 'sm',
                                'h-3 w-3': size === 'md',
                                'h-4 w-4': size === 'lg'
                            })}
                            style={{ animationDelay: '0ms' }}
                        />
                        <div
                            className={cn('rounded-full bg-primary animate-bounce', {
                                'h-2 w-2': size === 'sm',
                                'h-3 w-3': size === 'md',
                                'h-4 w-4': size === 'lg'
                            })}
                            style={{ animationDelay: '150ms' }}
                        />
                        <div
                            className={cn('rounded-full bg-primary animate-bounce', {
                                'h-2 w-2': size === 'sm',
                                'h-3 w-3': size === 'md',
                                'h-4 w-4': size === 'lg'
                            })}
                            style={{ animationDelay: '300ms' }}
                        />
                    </div>
                    {text && (
                        <span className={cn('text-muted-foreground', textSizeClasses[size])}>
                            {text}
                        </span>
                    )}
                </div>
            )
        }

        if (variant === 'pulse') {
            return (
                <div
                    ref={ref}
                    className={cn('flex items-center justify-center gap-2', className)}
                    {...props}
                >
                    <div
                        className={cn('rounded-full bg-primary animate-pulse', {
                            'h-4 w-4': size === 'sm',
                            'h-6 w-6': size === 'md',
                            'h-8 w-8': size === 'lg'
                        })}
                    />
                    {text && (
                        <span className={cn('text-muted-foreground', textSizeClasses[size])}>
                            {text}
                        </span>
                    )}
                </div>
            )
        }

        return null
    }
)

Loading.displayName = 'Loading'

// Page Loading Component
export const PageLoading = () => (
    <div className="min-h-screen flex items-center justify-center">
        <Loading size="lg" text="Loading..." />
    </div>
)

// Skeleton Components
export const Skeleton = React.forwardRef<
    HTMLDivElement,
    React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => {
    return (
        <div
            ref={ref}
            className={cn('animate-pulse rounded-md bg-muted', className)}
            {...props}
        />
    )
})
Skeleton.displayName = 'Skeleton'

export const CardSkeleton = () => (
    <div className="space-y-3">
        <Skeleton className="h-[125px] w-full rounded-xl" />
        <div className="space-y-2">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-[80%]" />
        </div>
    </div>
)

export const TextSkeleton = () => (
    <div className="space-y-2">
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-[75%]" />
    </div>
)

export { Loading } 