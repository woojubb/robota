'use client';

import { useState, useEffect, useRef, ReactNode } from 'react';

interface LazyLoadProps {
    children: ReactNode;
    placeholder?: ReactNode;
    threshold?: number;
    rootMargin?: string;
    className?: string;
    onVisible?: () => void;
}

export function LazyLoad({
    children,
    placeholder,
    threshold = 0.1,
    rootMargin = '50px',
    className,
    onVisible,
}: LazyLoadProps) {
    const [isVisible, setIsVisible] = useState(false);
    const elementRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const observer = new IntersectionObserver(
            ([entry]) => {
                if (entry.isIntersecting && !isVisible) {
                    setIsVisible(true);
                    onVisible?.();

                    // Disconnect observer after element becomes visible
                    if (elementRef.current) {
                        observer.unobserve(elementRef.current);
                    }
                }
            },
            {
                threshold,
                rootMargin,
            }
        );

        if (elementRef.current) {
            observer.observe(elementRef.current);
        }

        return () => {
            if (elementRef.current) {
                observer.unobserve(elementRef.current);
            }
        };
    }, [threshold, rootMargin, isVisible, onVisible]);

    return (
        <div ref={elementRef} className={className}>
            {isVisible ? children : (placeholder || <LazyLoadPlaceholder />)}
        </div>
    );
}

// Default placeholder component
export function LazyLoadPlaceholder({ className }: { className?: string }) {
    return (
        <div className={`bg-muted animate-pulse rounded ${className || 'h-32 w-full'}`} />
    );
}

// Specific lazy loading components
export function LazySection({
    children,
    className
}: {
    children: ReactNode;
    className?: string;
}) {
    return (
        <LazyLoad
            className={className}
            placeholder={<LazyLoadPlaceholder className="h-64 w-full" />}
            threshold={0.1}
            rootMargin="100px"
        >
            {children}
        </LazyLoad>
    );
}

export function LazyCard({
    children,
    className
}: {
    children: ReactNode;
    className?: string;
}) {
    return (
        <LazyLoad
            className={className}
            placeholder={<LazyLoadPlaceholder className="h-48 w-full rounded-lg" />}
            threshold={0.2}
            rootMargin="50px"
        >
            {children}
        </LazyLoad>
    );
}

// Hook for lazy loading data
export function useLazyLoad<T>(
    loadFn: () => Promise<T>,
    deps: any[] = []
) {
    const [data, setData] = useState<T | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<Error | null>(null);
    const [isVisible, setIsVisible] = useState(false);

    const load = async () => {
        if (loading || data) return;

        setLoading(true);
        setError(null);

        try {
            const result = await loadFn();
            setData(result);
        } catch (err) {
            setError(err instanceof Error ? err : new Error('Unknown error'));
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        if (isVisible) {
            load();
        }
    }, [isVisible, ...deps]);

    return {
        data,
        loading,
        error,
        setIsVisible,
        reload: load,
    };
} 