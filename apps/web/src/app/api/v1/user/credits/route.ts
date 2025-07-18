import { NextRequest } from 'next/server';
import { withAuth, createSuccessResponse, createErrorResponse } from '@/lib/auth-middleware';
import { getUserCreditSummary } from '@/lib/firebase/user-credit-service';
import { creditCache, cacheKeys } from '@/lib/cache';

/**
 * Get user credit summary
 * GET /api/v1/user/credits
 */
export const GET = withAuth(async (request: NextRequest, { uid }) => {
    try {
        // Check cache first
        const cacheKey = cacheKeys.userCredits(uid);
        const cachedCredits = creditCache.get(cacheKey);
        if (cachedCredits) {
            return createSuccessResponse(cachedCredits);
        }

        const creditSummary = await getUserCreditSummary(uid);

        if (!creditSummary) {
            return createErrorResponse('Credit information not found', 404, 'CREDITS_NOT_FOUND');
        }

        // Cache for 2 minutes (shorter TTL for credit data)
        creditCache.set(cacheKey, creditSummary, 2 * 60 * 1000);

        return createSuccessResponse(creditSummary);
    } catch (error) {
        console.error('Error fetching user credits:', error);
        return createErrorResponse('Failed to fetch credit information', 500);
    }
}); 