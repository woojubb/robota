import { NextRequest } from 'next/server';
import { withAuth, createSuccessResponse } from '@/lib/auth-middleware';
import { WebLogger } from '@/lib/web-logger';

/**
 * Test authentication endpoint
 * GET /api/v1/test-auth
 */
export const GET = withAuth(async (request: NextRequest, { uid }) => {
    WebLogger.debug('Test auth endpoint called', { uid });

    return createSuccessResponse({
        message: 'Authentication successful',
        uid,
        timestamp: new Date().toISOString()
    });
}); 