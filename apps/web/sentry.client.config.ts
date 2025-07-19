import * as Sentry from "@sentry/nextjs";

Sentry.init({
    dsn: process.env.SENTRY_DSN,

    // Performance Monitoring
    tracesSampleRate: 1.0,

    // Release Health
    autoSessionTracking: true,

    // Capture Replay
    replaysSessionSampleRate: 0.1,
    replaysOnErrorSampleRate: 1.0,

    integrations: [
        Sentry.replayIntegration({
            // Mask all text and input content
            maskAllText: true,
            blockAllMedia: true,
        }),
    ],

    // Environment
    environment: process.env.NEXT_PUBLIC_APP_ENV || 'development',

    // Release
    release: process.env.NEXT_PUBLIC_APP_VERSION,

    // Before Send Hook
    beforeSend(event, hint) {
        // Filter out development errors
        if (process.env.NODE_ENV === 'development') {
            return null;
        }

        // Filter out network errors
        if (event.exception) {
            const exception = event.exception.values?.[0];
            if (exception?.type === 'NetworkError' ||
                exception?.type === 'TypeError' &&
                exception?.value?.includes('fetch')) {
                return null;
            }
        }

        return event;
    },

    // Ignore specific errors
    ignoreErrors: [
        // Browser extensions
        'top.GLOBALS',
        'originalCreateNotification',
        'canvas.contentDocument',
        'MyApp_RemoveAllHighlights',
        'http://tt.epicplay.com',
        "Can't find variable: ZiteReader",
        'jigsaw is not defined',
        'ComboSearch is not defined',
        'http://loading.retry.widdit.com/',
        'atomicFindClose',
        // Network errors
        'NetworkError',
        'Failed to fetch',
        'Load failed',
        // Non-Error Promise Rejections
        'Non-Error promise rejection',
        // ResizeObserver errors
        'ResizeObserver loop limit exceeded',
    ],

    // Don't send breadcrumbs for these categories
    beforeBreadcrumb(breadcrumb, hint) {
        if (breadcrumb.category === 'console' && breadcrumb.level !== 'error') {
            return null;
        }

        return breadcrumb;
    },
}); 