'use client';

import { useEffect } from 'react';
import Script from 'next/script';
import { usePathname, useSearchParams } from 'next/navigation';
import { GA_TRACKING_ID, initGA, trackPageView, setUserId, isGAEnabled } from '@/lib/analytics/google-analytics';
import { initWebVitals, observePerformance } from '@/lib/analytics/web-vitals';
import { useAuth } from '@/contexts/auth-context';

export function GoogleAnalytics() {
    const pathname = usePathname();
    const searchParams = useSearchParams();
    const { user } = useAuth();

    // Track page views on route changes
    useEffect(() => {
        if (isGAEnabled()) {
            const url = pathname + (searchParams?.toString() ? `?${searchParams}` : '');
            trackPageView(url);
        }
    }, [pathname, searchParams]);

    // Track user ID when user signs in
    useEffect(() => {
        if (user?.uid && isGAEnabled()) {
            setUserId(user.uid);
        }
    }, [user]);

    // Initialize Web Vitals and performance monitoring
    useEffect(() => {
        if (isGAEnabled()) {
            initWebVitals();
            observePerformance();
        }
    }, []);

    // Don't render anything if GA is not enabled
    if (!isGAEnabled()) {
        return null;
    }

    return (
        <>
            <Script
                strategy="afterInteractive"
                src={`https://www.googletagmanager.com/gtag/js?id=${GA_TRACKING_ID}`}
            />
            <Script
                id="google-analytics"
                strategy="afterInteractive"
                dangerouslySetInnerHTML={{
                    __html: `
                        window.dataLayer = window.dataLayer || [];
                        function gtag(){dataLayer.push(arguments);}
                        gtag('js', new Date());
                        gtag('config', '${GA_TRACKING_ID}', {
                            page_path: window.location.pathname,
                            page_title: document.title,
                            page_location: window.location.href,
                        });
                    `,
                }}
            />
        </>
    );
}

// Hook for using Google Analytics in components
export function useAnalytics() {
    const { user } = useAuth();

    return {
        trackEvent: (action: string, category: string, label?: string, value?: number) => {
            if (!isGAEnabled()) return;

            window.gtag('event', action, {
                event_category: category,
                event_label: label,
                value: value,
                user_id: user?.uid,
            });
        },
        trackPageView: (url?: string) => {
            trackPageView(url);
        },
        setUserProperties: (properties: Record<string, any>) => {
            if (!isGAEnabled()) return;

            window.gtag('config', GA_TRACKING_ID!, {
                custom_map: properties,
            });
        },
    };
} 