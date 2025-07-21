import { NextRequest, NextResponse } from 'next/server';
// Firebase Admin removed to prevent browser bundling issues
// import { auth } from '@/lib/firebase/admin';

/**
 * Next.js Middleware for Rate Limiting and Security
 */
export async function middleware(request: NextRequest) {
    const { pathname } = request.nextUrl;

    // Skip middleware for static files and non-API routes
    if (
        pathname.startsWith('/_next/') ||
        pathname.startsWith('/static/') ||
        pathname.includes('.') ||
        !pathname.startsWith('/api/')
    ) {
        return NextResponse.next();
    }

    // Apply rate limiting to playground API routes
    if (pathname.startsWith('/api/v1/auth/playground-')) {
        return await handlePlaygroundRateLimit(request);
    }

    return NextResponse.next();
}

/**
 * Handle rate limiting for playground API endpoints
 */
async function handlePlaygroundRateLimit(request: NextRequest): Promise<NextResponse> {
    try {
        // Extract user info from Authorization header
        const authHeader = request.headers.get('Authorization');
        let userId = 'anonymous';
        let userTier = 'free';

        if (authHeader && authHeader.startsWith('Bearer ')) {
            try {
                // For development, skip Firebase verification and use mock data
                if (process.env.NODE_ENV === 'development') {
                    userId = 'dev-user-id';
                    userTier = 'pro';
                } else {
                    // In production, you would verify the token here
                    // For now, continue with anonymous limits
                    console.warn('Firebase Admin not available in middleware, using anonymous limits');
                }
            } catch (error) {
                // Continue with anonymous limits if token is invalid
                console.warn('Invalid token in rate limiting:', error);
            }
        }

        // Apply rate limiting
        const rateLimitResult = await applyRateLimit(userId, userTier, request);

        if (!rateLimitResult.allowed) {
            return NextResponse.json(
                {
                    error: 'Rate limit exceeded',
                    message: 'Too many requests. Please try again later.',
                    rateLimitInfo: {
                        limit: rateLimitResult.limit,
                        remaining: rateLimitResult.remaining,
                        resetTime: rateLimitResult.resetTime
                    }
                },
                {
                    status: 429,
                    headers: rateLimitResult.headers
                }
            );
        }

        // Add rate limit headers and continue
        const response = NextResponse.next();
        Object.entries(rateLimitResult.headers).forEach(([key, value]) => {
            response.headers.set(key, value);
        });

        return response;

    } catch (error) {
        console.error('Rate limiting middleware error:', error);
        // Continue without rate limiting on error
        return NextResponse.next();
    }
}

/**
 * Apply rate limiting logic
 */
async function applyRateLimit(
    userId: string,
    userTier: string,
    request: NextRequest
): Promise<{
    allowed: boolean;
    limit: number;
    remaining: number;
    resetTime: string;
    headers: Record<string, string>;
}> {
    // Get client IP for additional limiting
    const clientIP = request.headers.get('x-forwarded-for') ||
        request.headers.get('x-real-ip') ||
        'unknown';

    // Define limits based on user tier
    const tierLimits = {
        free: { requestsPerMinute: 5, requestsPerHour: 50 },
        pro: { requestsPerMinute: 30, requestsPerHour: 500 },
        enterprise: { requestsPerMinute: 100, requestsPerHour: 2000 }
    };

    const limits = tierLimits[userTier as keyof typeof tierLimits] || tierLimits.free;

    // Simple in-memory rate limiting (use Redis in production)
    const now = Date.now();
    const windowMs = 60 * 1000; // 1 minute window
    const key = `${userId}:${Math.floor(now / windowMs)}`;

    // This is a simplified version - use the full rate limiter in production
    const requestCount = await getRequestCount(key);
    const allowed = requestCount < limits.requestsPerMinute;
    const remaining = Math.max(0, limits.requestsPerMinute - requestCount - 1);
    const resetTime = new Date(Math.ceil(now / windowMs) * windowMs).toISOString();

    if (allowed) {
        await incrementRequestCount(key);
    }

    return {
        allowed,
        limit: limits.requestsPerMinute,
        remaining,
        resetTime,
        headers: {
            'X-RateLimit-Limit': limits.requestsPerMinute.toString(),
            'X-RateLimit-Remaining': remaining.toString(),
            'X-RateLimit-Reset': Math.ceil(Date.parse(resetTime) / 1000).toString(),
            'X-RateLimit-Policy': `${limits.requestsPerMinute} requests per minute`
        }
    };
}

// Simple in-memory store (use Redis in production)
const requestStore = new Map<string, number>();

async function getRequestCount(key: string): Promise<number> {
    return requestStore.get(key) || 0;
}

async function incrementRequestCount(key: string): Promise<void> {
    const current = requestStore.get(key) || 0;
    requestStore.set(key, current + 1);

    // Clean up old entries
    setTimeout(() => {
        requestStore.delete(key);
    }, 60 * 1000); // Clean up after 1 minute
}

export const config = {
    matcher: [
        '/api/v1/auth/playground-token',
        '/api/v1/auth/playground-limits'
    ]
}; 