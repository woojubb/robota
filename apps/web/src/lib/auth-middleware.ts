import { NextRequest, NextResponse } from 'next/server';
import { ApiResponse } from './api-client';

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
        console.error('JWT decode error:', error);
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

    console.log('Token verification started:', {
        hasAuthHeader: !!authHeader,
        hasToken: !!token,
        tokenLength: token?.length,
        requestUrl: request.url
    });

    if (!token) {
        console.log('No token provided');
        return { error: 'No authentication token provided', status: 401 };
    }

    try {
        // Use basic JWT validation for now
        const validation = validateJWTToken(token);

        console.log('Token validation result:', {
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

        console.log('Token verification successful for user:', validation.uid);
        return { uid: validation.uid };
    } catch (error) {
        console.error('Token verification error:', error);
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
        console.log(`withAuth: Processing ${request.method} ${request.url}`);

        const { uid, error, status } = await verifyAuthToken(request);

        if (error || !uid) {
            console.log('withAuth: Authentication failed:', { error, status, uid });
            return createErrorResponse(error || 'Unauthorized', status || 401, 'AUTH_ERROR');
        }

        try {
            console.log(`withAuth: Authentication successful, calling handler for user: ${uid}`);
            const response = await handler(request, { uid });
            console.log(`withAuth: Handler completed successfully for ${request.url}`);
            return response;
        } catch (error) {
            console.error('withAuth: API handler error:', error);
            return createErrorResponse(
                error instanceof Error ? error.message : 'Internal server error',
                500,
                'SERVER_ERROR'
            );
        }
    };
} 