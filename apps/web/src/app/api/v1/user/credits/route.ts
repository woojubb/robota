import { NextRequest } from 'next/server';
import { withAuth, createSuccessResponse, createErrorResponse } from '@/lib/auth-middleware';
import { getUserCreditSummary } from '@/lib/firebase/user-credit-service';
import { creditCache, cacheKeys } from '@/lib/cache';
import { WebLogger } from '@/lib/web-logger';

/**
 * Get user credit summary
 * GET /api/v1/user/credits
 */
export const GET = withAuth(async (request: NextRequest, { uid }) => {
    WebLogger.debug('Credits API GET: start', { uid });

    try {
        // Check cache first
        WebLogger.debug('Credits API: checking cache', { uid });
        const cacheKey = cacheKeys.userCredits(uid);
        const cachedCredits = creditCache.get(cacheKey);
        if (cachedCredits) {
            WebLogger.debug('Credits API: cache hit', { uid });
            return createSuccessResponse(cachedCredits);
        }
        WebLogger.debug('Credits API: cache miss, fetching from Firestore', { uid });

        let creditSummary;

        try {
            WebLogger.debug('Credits API: fetching credit summary from Firestore', { uid });
            creditSummary = await getUserCreditSummary(uid);
            WebLogger.debug('Credits API: credit summary fetched', { uid, hasCreditSummary: !!creditSummary });
        } catch (firestoreError) {
            WebLogger.error('Credits API: Firestore connection error', { uid, error: firestoreError instanceof Error ? firestoreError.message : String(firestoreError) });
            WebLogger.warn('Credits API: returning default credits due to Firestore connectivity issue', { uid });

            // Return default credit summary when Firestore is unavailable
            const defaultCredits = {
                uid,
                subscription_plan: 'free',
                total_credits: 100,
                used_credits: 0,
                subscription_credits: 100,
                purchased_credits: 0,
                usage_this_month: 0,
                last_credit_update: new Date().toISOString(),
            };

            // Cache the default credits for a shorter time
            creditCache.set(cacheKey, defaultCredits, 30 * 1000); // 30 seconds

            return createSuccessResponse(defaultCredits, 'Default credits returned due to database connectivity issue');
        }

        if (!creditSummary) {
            WebLogger.warn('Credits API: no credit summary found, returning default', { uid });

            // Create default credit summary if none exists
            const defaultCredits = {
                uid,
                subscription_plan: 'free',
                total_credits: 100,
                used_credits: 0,
                subscription_credits: 100,
                purchased_credits: 0,
                usage_this_month: 0,
                last_credit_update: new Date().toISOString(),
            };

            // Cache for a shorter time since it's default data
            creditCache.set(cacheKey, defaultCredits, 1 * 60 * 1000); // 1 minute

            return createSuccessResponse(defaultCredits);
        }

        WebLogger.debug('Credits API: credit summary processed successfully', { uid });

        // Cache for 2 minutes (shorter TTL for credit data)
        creditCache.set(cacheKey, creditSummary, 2 * 60 * 1000);

        return createSuccessResponse(creditSummary);
    } catch (error) {
        WebLogger.error('Credits API: error occurred', { uid, error: error instanceof Error ? error.message : String(error) });

        // Return default credits as last resort
        const fallbackCredits = {
            uid,
            subscription_plan: 'free',
            total_credits: 100,
            used_credits: 0,
            subscription_credits: 100,
            purchased_credits: 0,
            usage_this_month: 0,
            last_credit_update: new Date().toISOString(),
        };

        WebLogger.warn('Credits API: returning fallback credits due to error', { uid });
        return createSuccessResponse(fallbackCredits, 'Fallback credits returned due to error');
    }
}); 