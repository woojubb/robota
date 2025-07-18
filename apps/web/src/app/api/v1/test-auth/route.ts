import { NextRequest } from 'next/server';
import { withAuth, createSuccessResponse } from '@/lib/auth-middleware';

/**
 * Test authentication endpoint
 * GET /api/v1/test-auth
 */
export const GET = withAuth(async (request: NextRequest, { uid }) => {
    console.log('Test auth endpoint called for user:', uid);

    return createSuccessResponse({
        message: 'Authentication successful',
        uid,
        timestamp: new Date().toISOString()
    });
}); 