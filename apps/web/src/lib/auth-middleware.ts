import { NextRequest, NextResponse } from 'next/server';
import { ApiResponse } from './api-client';
import { WebLogger } from '@/lib/web-logger';

/**
 * Decode JWT token without verification (for development/testing)
 * In production, this should be replaced with Firebase Admin SDK
 */
function decodeJWTPayload(token: string): any {
    try {
        const parts = token.split('.');
        if (parts.length !== 3) {
            throw new Error('Invalid JWT format');
        }

        const payload = parts[1];
        const decoded = Buffer.from(payload, 'base64url').toString('utf-8');
        return JSON.parse(decoded);
    } catch (error) {
        WebLogger.error('JWT decode error', { error: error instanceof Error ? error.message : String(error) });
        return null;
    }
}

/**
 * Basic JWT token validation (for development)
 * In production, use Firebase Admin SDK for proper verification
 */
function validateJWTToken(token: string): { valid: boolean; uid?: string; error?: string } {
    const payload = decodeJWTPayload(token);

    if (!payload) {
        return { valid: false, error: 'Invalid token format' };
    }

    // Check expiration
    const now = Math.floor(Date.now() / 1000);
    if (payload.exp && payload.exp < now) {
        return { valid: false, error: 'Token expired' };
    }

    // Check if it's a Firebase token
    if (!payload.iss || !payload.iss.includes('securetoken.google.com')) {
        return { valid: false, error: 'Invalid token issuer' };
    }

    // Check if user_id exists
    if (!payload.user_id && !payload.sub) {
        return { valid: false, error: 'No user ID in token' };
    }

    return {
        valid: true,
        uid: payload.user_id || payload.sub
    };
}

/**
 * Verify Firebase Auth token from request
 */
export async function verifyAuthToken(request: NextRequest): Promise<{
    uid?: string;
    error?: string;
    status?: number;
}> {
    const authHeader = request.headers.get('authorization');
    const token = authHeader?.split('Bearer ')[1];

    WebLogger.debug('Token verification started', {
        hasAuthHeader: !!authHeader,
        hasToken: !!token,
        tokenLength: token?.length,
        requestUrl: request.url
    });

    if (!token) {
        WebLogger.warn('No token provided');
        return { error: 'No authentication token provided', status: 401 };
    }

    try {
        // Use basic JWT validation for now
        const validation = validateJWTToken(token);

        WebLogger.debug('Token validation result', {
            valid: validation.valid,
            uid: validation.uid ? `${validation.uid.substring(0, 8)}...` : undefined,
            error: validation.error
        });

        if (!validation.valid || !validation.uid) {
            return {
                error: validation.error || 'Invalid authentication token',
                status: 401
            };
        }

        WebLogger.debug('Token verification successful', { uid: validation.uid });
        return { uid: validation.uid };
    } catch (error) {
        WebLogger.error('Token verification error', { error: error instanceof Error ? error.message : String(error) });
        return { error: 'Token verification failed', status: 401 };
    }
}

/**
 * Create an error response
 */
export function createErrorResponse(
    error: string,
    status: number = 400,
    code?: string
): NextResponse<ApiResponse> {
    return NextResponse.json(
        {
            success: false,
            error,
            code,
        },
        {
            status,
            headers: {
                'Cache-Control': 'no-cache, no-store, must-revalidate',
                'Pragma': 'no-cache',
                'Expires': '0',
            }
        }
    );
}

/**
 * Create a success response with optional caching
 */
export function createSuccessResponse<T = any>(
    data: T,
    message?: string,
    status: number = 200,
    cacheControl?: string
): NextResponse<ApiResponse<T>> {
    const headers: Record<string, string> = {
        'Content-Type': 'application/json',
    };

    // Add cache control if specified
    if (cacheControl) {
        headers['Cache-Control'] = cacheControl;
    } else {
        // Default to private cache for 60 seconds
        headers['Cache-Control'] = 'private, max-age=60';
    }

    return NextResponse.json(
        {
            success: true,
            data,
            message,
        },
        { status, headers }
    );
}

/**
 * Middleware wrapper for protected routes
 */
export function withAuth(
    handler: (request: NextRequest, context: { uid: string }) => Promise<NextResponse>
) {
    return async (request: NextRequest): Promise<NextResponse> => {
        WebLogger.debug('withAuth: processing request', { method: request.method, url: request.url });

        const { uid, error, status } = await verifyAuthToken(request);

        if (error || !uid) {
            WebLogger.warn('withAuth: authentication failed', { error, status, uid });
            return createErrorResponse(error || 'Unauthorized', status || 401, 'AUTH_ERROR');
        }

        try {
            WebLogger.debug('withAuth: authentication successful, calling handler', { uid });
            const response = await handler(request, { uid });
            WebLogger.debug('withAuth: handler completed successfully', { url: request.url, uid });
            return response;
        } catch (error) {
            WebLogger.error('withAuth: API handler error', { uid, error: error instanceof Error ? error.message : String(error) });
            return createErrorResponse(
                error instanceof Error ? error.message : 'Internal server error',
                500,
                'SERVER_ERROR'
            );
        }
    };
} 