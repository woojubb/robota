/**
 * Rate Limiting System for Robota Playground
 * 
 * Implements user-based rate limiting with different tiers and usage tracking
 */

export interface RateLimitConfig {
    windowMs: number; // Time window in milliseconds
    maxRequests: number; // Maximum requests per window
    skipSuccessfulRequests?: boolean;
    skipFailedRequests?: boolean;
    keyGenerator?: (identifier: string) => string;
}

export interface RateLimitResult {
    allowed: boolean;
    remaining: number;
    resetTime: Date;
    totalRequests: number;
    error?: string;
}

export interface UserTier {
    tier: 'free' | 'pro' | 'enterprise';
    limits: {
        requestsPerMinute: number;
        requestsPerHour: number;
        requestsPerDay: number;
        maxConcurrentSessions: number;
    };
}

// Default tier configurations
const DEFAULT_TIERS: Record<string, UserTier> = {
    free: {
        tier: 'free',
        limits: {
            requestsPerMinute: 5,
            requestsPerHour: 50,
            requestsPerDay: 100,
            maxConcurrentSessions: 1
        }
    },
    pro: {
        tier: 'pro',
        limits: {
            requestsPerMinute: 30,
            requestsPerHour: 500,
            requestsPerDay: 2000,
            maxConcurrentSessions: 5
        }
    },
    enterprise: {
        tier: 'enterprise',
        limits: {
            requestsPerMinute: 100,
            requestsPerHour: 2000,
            requestsPerDay: 10000,
            maxConcurrentSessions: 20
        }
    }
};

/**
 * In-memory rate limiter (for development)
 * In production, use Redis or similar distributed cache
 */
class InMemoryRateLimiter {
    private store = new Map<string, {
        requests: { timestamp: number; success: boolean }[];
        sessions: Set<string>;
    }>();

    private cleanup() {
        const now = Date.now();
        const oneDayAgo = now - 24 * 60 * 60 * 1000;

        for (const [key, data] of this.store.entries()) {
            // Remove old requests
            data.requests = data.requests.filter(req => req.timestamp > oneDayAgo);

            // Remove empty entries
            if (data.requests.length === 0 && data.sessions.size === 0) {
                this.store.delete(key);
            }
        }
    }

    async checkLimit(
        identifier: string,
        config: RateLimitConfig,
        sessionId?: string
    ): Promise<RateLimitResult> {
        this.cleanup();

        const key = config.keyGenerator ? config.keyGenerator(identifier) : identifier;
        const now = Date.now();
        const windowStart = now - config.windowMs;

        if (!this.store.has(key)) {
            this.store.set(key, { requests: [], sessions: new Set() });
        }

        const userData = this.store.get(key)!;

        // Count requests in current window
        const requestsInWindow = userData.requests.filter(req => {
            const inWindow = req.timestamp > windowStart;
            const shouldCount = config.skipSuccessfulRequests ? !req.success :
                config.skipFailedRequests ? req.success : true;
            return inWindow && shouldCount;
        });

        const allowed = requestsInWindow.length < config.maxRequests;
        const remaining = Math.max(0, config.maxRequests - requestsInWindow.length);
        const resetTime = new Date(now + config.windowMs);

        // Track session if provided
        if (sessionId) {
            userData.sessions.add(sessionId);
        }

        return {
            allowed,
            remaining,
            resetTime,
            totalRequests: requestsInWindow.length,
            error: allowed ? undefined : 'Rate limit exceeded'
        };
    }

    async recordRequest(identifier: string, success: boolean, sessionId?: string): Promise<void> {
        const userData = this.store.get(identifier);
        if (userData) {
            userData.requests.push({ timestamp: Date.now(), success });
            if (sessionId) {
                userData.sessions.add(sessionId);
            }
        }
    }

    async getActiveSessionCount(identifier: string): Promise<number> {
        const userData = this.store.get(identifier);
        return userData ? userData.sessions.size : 0;
    }

    async removeSession(identifier: string, sessionId: string): Promise<void> {
        const userData = this.store.get(identifier);
        if (userData) {
            userData.sessions.delete(sessionId);
        }
    }
}

/**
 * Rate limiter instance
 */
const rateLimiter = new InMemoryRateLimiter();

/**
 * Check rate limit for a user
 */
export async function checkRateLimit(
    userId: string,
    userTier: string = 'free',
    sessionId?: string
): Promise<{
    minute: RateLimitResult;
    hour: RateLimitResult;
    day: RateLimitResult;
    sessions: { active: number; limit: number; allowed: boolean };
}> {
    const tier = DEFAULT_TIERS[userTier] || DEFAULT_TIERS.free;
    const now = Date.now();

    // Check different time windows
    const [minute, hour, day] = await Promise.all([
        rateLimiter.checkLimit(userId, {
            windowMs: 60 * 1000, // 1 minute
            maxRequests: tier.limits.requestsPerMinute,
            keyGenerator: (id) => `${id}:minute`
        }, sessionId),

        rateLimiter.checkLimit(userId, {
            windowMs: 60 * 60 * 1000, // 1 hour
            maxRequests: tier.limits.requestsPerHour,
            keyGenerator: (id) => `${id}:hour`
        }, sessionId),

        rateLimiter.checkLimit(userId, {
            windowMs: 24 * 60 * 60 * 1000, // 1 day
            maxRequests: tier.limits.requestsPerDay,
            keyGenerator: (id) => `${id}:day`
        }, sessionId)
    ]);

    // Check concurrent sessions
    const activeSessions = await rateLimiter.getActiveSessionCount(userId);
    const sessionLimit = tier.limits.maxConcurrentSessions;

    return {
        minute,
        hour,
        day,
        sessions: {
            active: activeSessions,
            limit: sessionLimit,
            allowed: activeSessions < sessionLimit
        }
    };
}

/**
 * Record a request for rate limiting
 */
export async function recordRequest(
    userId: string,
    success: boolean,
    userTier: string = 'free',
    sessionId?: string
): Promise<void> {
    await Promise.all([
        rateLimiter.recordRequest(`${userId}:minute`, success, sessionId),
        rateLimiter.recordRequest(`${userId}:hour`, success, sessionId),
        rateLimiter.recordRequest(`${userId}:day`, success, sessionId)
    ]);
}

/**
 * Remove a session from tracking
 */
export async function removeSession(userId: string, sessionId: string): Promise<void> {
    await rateLimiter.removeSession(userId, sessionId);
}

/**
 * Get user tier configuration
 */
export function getUserTierConfig(tier: string): UserTier {
    return DEFAULT_TIERS[tier] || DEFAULT_TIERS.free;
}

/**
 * Create rate limit headers for HTTP responses
 */
export function createRateLimitHeaders(result: RateLimitResult, prefix: string = ''): Record<string, string> {
    return {
        [`${prefix}X-RateLimit-Limit`]: result.totalRequests.toString(),
        [`${prefix}X-RateLimit-Remaining`]: result.remaining.toString(),
        [`${prefix}X-RateLimit-Reset`]: Math.ceil(result.resetTime.getTime() / 1000).toString()
    };
} 