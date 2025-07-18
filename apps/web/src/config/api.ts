/**
 * API Configuration
 */
export const API_CONFIG = {
    // API version
    version: process.env.NEXT_PUBLIC_API_VERSION || 'v1',

    // Base URL for API endpoints
    get baseUrl() {
        return `/api/${this.version}`;
    },

    // Timeout settings
    timeout: 30000, // 30 seconds

    // Retry settings
    retry: {
        count: 3,
        delay: 1000,
        backoff: 2,
    },

    // Rate limiting
    rateLimit: {
        windowMs: 60 * 1000, // 1 minute
        maxRequests: 100,
    },
} as const; 