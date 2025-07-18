'use client';

import { useState } from 'react';
import Image from 'next/image';
import { cn } from '@/lib/utils';

interface OptimizedImageProps {
    src: string;
    alt: string;
    width?: number;
    height?: number;
    className?: string;
    priority?: boolean;
    quality?: number;
    placeholder?: 'blur' | 'empty';
    blurDataURL?: string;
    fill?: boolean;
    sizes?: string;
    fallbackSrc?: string;
    onLoad?: () => void;
    onError?: () => void;
}

export function OptimizedImage({
    src,
    alt,
    width,
    height,
    className,
    priority = false,
    quality = 75,
    placeholder = 'empty',
    blurDataURL,
    fill = false,
    sizes,
    fallbackSrc = '/images/placeholder.png',
    onLoad,
    onError,
    ...props
}: OptimizedImageProps) {
    const [imageSrc, setImageSrc] = useState(src);
    const [isLoading, setIsLoading] = useState(true);
    const [hasError, setHasError] = useState(false);

    const handleLoad = () => {
        setIsLoading(false);
        onLoad?.();
    };

    const handleError = () => {
        setHasError(true);
        setIsLoading(false);
        setImageSrc(fallbackSrc);
        onError?.();
    };

    return (
        <div className={cn('relative overflow-hidden', className)}>
            {isLoading && (
                <div className="absolute inset-0 bg-muted animate-pulse rounded" />
            )}

            <Image
                src={imageSrc}
                alt={alt}
                width={fill ? undefined : width}
                height={fill ? undefined : height}
                fill={fill}
                priority={priority}
                quality={quality}
                placeholder={placeholder}
                blurDataURL={blurDataURL}
                sizes={sizes}
                className={cn(
                    'transition-opacity duration-300',
                    isLoading ? 'opacity-0' : 'opacity-100',
                    className
                )}
                onLoad={handleLoad}
                onError={handleError}
                {...props}
            />

            {hasError && !isLoading && (
                <div className="absolute inset-0 flex items-center justify-center bg-muted text-muted-foreground">
                    <span className="text-sm">Failed to load image</span>
                </div>
            )}
        </div>
    );
}

// Utility function to generate blur data URL
export const generateBlurDataURL = (width: number = 10, height: number = 10): string => {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;

    const ctx = canvas.getContext('2d');
    if (!ctx) return '';

    // Create a simple gradient blur effect
    const gradient = ctx.createLinearGradient(0, 0, width, height);
    gradient.addColorStop(0, '#f3f4f6');
    gradient.addColorStop(1, '#e5e7eb');

    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);

    return canvas.toDataURL();
};

// Pre-built optimized image variants
export const HeroImage = ({
    src,
    alt,
    className
}: {
    src: string;
    alt: string;
    className?: string;
}) => (
    <OptimizedImage
        src={src}
        alt={alt}
        width={1200}
        height={800}
        className={className}
        priority
        quality={85}
        sizes="(max-width: 768px) 100vw, (max-width: 1200px) 80vw, 1200px"
    />
);

export const ThumbnailImage = ({
    src,
    alt,
    className
}: {
    src: string;
    alt: string;
    className?: string;
}) => (
    <OptimizedImage
        src={src}
        alt={alt}
        width={300}
        height={200}
        className={className}
        quality={60}
        sizes="(max-width: 768px) 50vw, 300px"
    />
);

export const ProfileImage = ({
    src,
    alt,
    className,
    size = 'md'
}: {
    src: string;
    alt: string;
    className?: string;
    size?: 'sm' | 'md' | 'lg' | 'xl';
}) => {
    const sizeMap = {
        sm: { width: 40, height: 40 },
        md: { width: 80, height: 80 },
        lg: { width: 120, height: 120 },
        xl: { width: 200, height: 200 },
    };

    const { width, height } = sizeMap[size];

    return (
        <OptimizedImage
            src={src}
            alt={alt}
            width={width}
            height={height}
            className={cn('rounded-full', className)}
            quality={80}
            sizes={`${width}px`}
        />
    );
}; 