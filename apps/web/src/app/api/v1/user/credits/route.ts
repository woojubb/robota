import { NextRequest } from 'next/server';
import { withAuth, createSuccessResponse, createErrorResponse } from '@/lib/auth-middleware';
import { getUserCreditSummary } from '@/lib/firebase/user-credit-service';
import { creditCache, cacheKeys } from '@/lib/cache';

/**
 * Get user credit summary
 * GET /api/v1/user/credits
 */
export const GET = withAuth(async (request: NextRequest, { uid }) => {
    console.log('Credits API GET: Starting for user:', uid);

    try {
        // Check cache first
        console.log('Credits API: Checking cache...');
        const cacheKey = cacheKeys.userCredits(uid);
        const cachedCredits = creditCache.get(cacheKey);
        if (cachedCredits) {
            console.log('Credits API: Cache hit, returning cached data');
            return createSuccessResponse(cachedCredits);
        }
        console.log('Credits API: Cache miss, fetching from Firestore');

        let creditSummary;

        try {
            console.log('Credits API: Fetching credit summary from Firestore...');
            creditSummary = await getUserCreditSummary(uid);
            console.log('Credits API: Credit summary fetched:', !!creditSummary);
        } catch (firestoreError) {
            console.error('Credits API: Firestore connection error:', firestoreError);
            console.log('Credits API: Returning default credits due to Firestore connection issue');

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
            console.log('Credits API: No credit summary found, creating default');

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

        console.log('Credits API: Credit summary processed successfully');

        // Cache for 2 minutes (shorter TTL for credit data)
        creditCache.set(cacheKey, creditSummary, 2 * 60 * 1000);

        return createSuccessResponse(creditSummary);
    } catch (error) {
        console.error('Credits API: Error occurred:', error);
        console.error('Credits API: Error stack:', error instanceof Error ? error.stack : 'No stack trace');

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

        console.log('Credits API: Returning fallback credits due to error');
        return createSuccessResponse(fallbackCredits, 'Fallback credits returned due to error');
    }
}); 