import * as Sentry from "@sentry/nextjs";

Sentry.init({
    dsn: process.env.SENTRY_DSN,

    // Performance Monitoring
    tracesSampleRate: 1.0,

    // Environment
    environment: process.env.NEXT_PUBLIC_APP_ENV || 'development',

    // Release
    release: process.env.NEXT_PUBLIC_APP_VERSION,

    // Server-specific configuration
    integrations: [
        // Add server-specific integrations here
    ],

    // Before Send Hook
    beforeSend(event, hint) {
        // Filter out development errors
        if (process.env.NODE_ENV === 'development') {
            return null;
        }

        // Add server context
        if (event.tags) {
            event.tags.server = true;
        } else {
            event.tags = { server: true };
        }

        return event;
    },

    // Ignore specific server errors
    ignoreErrors: [
        'ECONNRESET',
        'ENOTFOUND',
        'ETIMEDOUT',
        'socket hang up',
    ],
}); 