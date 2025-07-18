import { onCLS, onFID, onFCP, onLCP, onTTFB, Metric } from 'web-vitals';
import { trackEvent } from './google-analytics';

// Core Web Vitals thresholds
const WEB_VITALS_THRESHOLDS = {
    CLS: { good: 0.1, needsImprovement: 0.25 },
    FID: { good: 100, needsImprovement: 300 },
    FCP: { good: 1800, needsImprovement: 3000 },
    LCP: { good: 2500, needsImprovement: 4000 },
    TTFB: { good: 800, needsImprovement: 1800 },
};

// Rate Web Vitals score
function rateWebVital(name: string, value: number): 'good' | 'needs-improvement' | 'poor' {
    const thresholds = WEB_VITALS_THRESHOLDS[name as keyof typeof WEB_VITALS_THRESHOLDS];
    if (!thresholds) return 'poor';

    if (value <= thresholds.good) return 'good';
    if (value <= thresholds.needsImprovement) return 'needs-improvement';
    return 'poor';
}

// Send Web Vitals to analytics
function sendToAnalytics(metric: Metric) {
    const rating = rateWebVital(metric.name, metric.value);

    trackEvent({
        action: metric.name,
        category: 'Web Vitals',
        label: rating,
        value: Math.round(metric.name === 'CLS' ? metric.value * 1000 : metric.value),
    });

    // Send to console in development
    if (process.env.NODE_ENV === 'development') {
        console.log('Web Vital:', {
            name: metric.name,
            value: metric.value,
            rating,
            delta: metric.delta,
            entries: metric.entries,
        });
    }
}

// Initialize Web Vitals tracking
export function initWebVitals(): void {
    if (typeof window === 'undefined') return;

    try {
        onCLS(sendToAnalytics);
        onFID(sendToAnalytics);
        onFCP(sendToAnalytics);
        onLCP(sendToAnalytics);
        onTTFB(sendToAnalytics);
    } catch (error) {
        console.error('Failed to initialize Web Vitals:', error);
    }
}

// Manual performance tracking
export function trackPerformance(name: string, startTime: number, endTime?: number): void {
    const duration = (endTime || performance.now()) - startTime;

    trackEvent({
        action: 'timing_complete',
        category: 'Performance',
        label: name,
        value: Math.round(duration),
    });
}

// Performance observer for custom metrics
export function observePerformance(): void {
    if (typeof window === 'undefined' || !window.PerformanceObserver) return;

    try {
        // Observe navigation timing
        const navigationObserver = new PerformanceObserver((list) => {
            for (const entry of list.getEntries()) {
                if (entry.entryType === 'navigation') {
                    const navEntry = entry as PerformanceNavigationTiming;

                    // Track navigation metrics
                    trackEvent({
                        action: 'navigation_timing',
                        category: 'Performance',
                        label: 'dom_content_loaded',
                        value: Math.round(navEntry.domContentLoadedEventEnd - navEntry.domContentLoadedEventStart),
                    });

                    trackEvent({
                        action: 'navigation_timing',
                        category: 'Performance',
                        label: 'load_complete',
                        value: Math.round(navEntry.loadEventEnd - navEntry.loadEventStart),
                    });
                }
            }
        });

        navigationObserver.observe({ entryTypes: ['navigation'] });

        // Observe resource timing for critical resources
        const resourceObserver = new PerformanceObserver((list) => {
            for (const entry of list.getEntries()) {
                const resourceEntry = entry as PerformanceResourceTiming;

                // Track critical resources (CSS, JS, images)
                if (resourceEntry.name.includes('.css') ||
                    resourceEntry.name.includes('.js') ||
                    resourceEntry.name.includes('image')) {

                    const resourceType = resourceEntry.name.includes('.css') ? 'CSS' :
                        resourceEntry.name.includes('.js') ? 'JavaScript' : 'Image';

                    trackEvent({
                        action: 'resource_timing',
                        category: 'Performance',
                        label: resourceType,
                        value: Math.round(resourceEntry.duration),
                    });
                }
            }
        });

        resourceObserver.observe({ entryTypes: ['resource'] });

    } catch (error) {
        console.error('Failed to observe performance:', error);
    }
}

// Hook for component performance tracking
export function usePerformanceTracker(componentName: string) {
    const startTime = performance.now();

    return {
        trackRender: () => {
            trackPerformance(`${componentName}_render`, startTime);
        },
        trackAction: (actionName: string, actionStartTime?: number) => {
            trackPerformance(
                `${componentName}_${actionName}`,
                actionStartTime || startTime
            );
        },
    };
} 