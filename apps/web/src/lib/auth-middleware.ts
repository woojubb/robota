import { NextRequest, NextResponse } from 'next/server';
import { auth } from './firebase/config';
import { ApiResponse } from './api-client';

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

    if (!token) {
        return { error: 'No authentication token provided', status: 401 };
    }

    try {
        // In a production environment, you would verify the token with Firebase Admin SDK
        // For now, we'll use a simple client-side verification
        // This should be replaced with proper server-side verification

        // TODO: Implement proper server-side token verification with Firebase Admin SDK
        // const decodedToken = await adminAuth.verifyIdToken(token);
        // return { uid: decodedToken.uid };

        // Temporary client-side verification (not secure for production)
        const currentUser = auth.currentUser;
        if (currentUser) {
            const userToken = await currentUser.getIdToken();
            if (userToken === token) {
                return { uid: currentUser.uid };
            }
        }

        return { error: 'Invalid authentication token', status: 401 };
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
        const { uid, error, status } = await verifyAuthToken(request);

        if (error || !uid) {
            return createErrorResponse(error || 'Unauthorized', status || 401, 'AUTH_ERROR');
        }

        try {
            return await handler(request, { uid });
        } catch (error) {
            console.error('API handler error:', error);
            return createErrorResponse(
                error instanceof Error ? error.message : 'Internal server error',
                500,
                'SERVER_ERROR'
            );
        }
    };
} 