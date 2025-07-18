import { NextRequest } from 'next/server';
import { withAuth, createSuccessResponse, createErrorResponse } from '@/lib/auth-middleware';
import { getUserCreditSummary } from '@/lib/firebase/user-credit-service';

/**
 * Get user credit summary
 * GET /api/v1/user/credits
 */
export const GET = withAuth(async (request: NextRequest, { uid }) => {
    try {
        const creditSummary = await getUserCreditSummary(uid);

        if (!creditSummary) {
            return createErrorResponse('Credit information not found', 404, 'CREDITS_NOT_FOUND');
        }

        return createSuccessResponse(creditSummary);
    } catch (error) {
        console.error('Error fetching user credits:', error);
        return createErrorResponse('Failed to fetch credit information', 500);
    }
}); 