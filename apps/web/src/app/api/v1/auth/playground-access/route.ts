import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/firebase/admin';

/**
 * Check if user has playground access
 * GET /api/v1/auth/playground-access
 */
export async function GET(request: NextRequest) {
    try {
        // Get Firebase ID token from Authorization header
        const authHeader = request.headers.get('Authorization');
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return NextResponse.json(
                { error: 'Missing or invalid authorization header' },
                { status: 401 }
            );
        }

        const idToken = authHeader.substring(7);

        // Verify Firebase ID token
        const decodedToken = await auth.verifyIdToken(idToken);
        const { uid, email } = decodedToken;

        // Check playground access
        const accessInfo = await checkPlaygroundAccess(uid);

        return NextResponse.json({
            hasAccess: accessInfo.hasAccess,
            userId: uid,
            email,
            subscription: accessInfo.subscription,
            limits: accessInfo.limits,
            reason: accessInfo.reason
        });

    } catch (error) {
        console.error('Error checking playground access:', error);

        return NextResponse.json(
            { error: 'Internal server error' },
            { status: 500 }
        );
    }
}

/**
 * Check if user has access to playground
 */
async function checkPlaygroundAccess(userId: string) {
    try {
        // Get user record from Firebase Auth
        const userRecord = await auth.getUser(userId);
        const customClaims = userRecord.customClaims || {};

        // Check subscription level
        const subscription = customClaims.subscription || 'free';

        // For now, allow all authenticated users with verified email
        const hasAccess = !!userRecord.email && userRecord.emailVerified;

        // Get subscription limits
        const limits = getSubscriptionLimits(subscription);

        return {
            hasAccess,
            subscription,
            limits,
            reason: hasAccess ? 'Verified user' : 'Email not verified'
        };

    } catch (error) {
        console.error('Error checking playground access:', error);
        return {
            hasAccess: false,
            subscription: 'free',
            limits: getSubscriptionLimits('free'),
            reason: 'Error checking access'
        };
    }
}

/**
 * Get limits based on subscription level
 */
function getSubscriptionLimits(subscription: string) {
    const limits = {
        free: {
            dailyExecutions: 10,
            maxTokens: 1000,
            allowedProviders: ['openai']
        },
        pro: {
            dailyExecutions: 100,
            maxTokens: 4000,
            allowedProviders: ['openai', 'anthropic', 'google']
        },
        enterprise: {
            dailyExecutions: 1000,
            maxTokens: 16000,
            allowedProviders: ['openai', 'anthropic', 'google']
        }
    };

    return limits[subscription as keyof typeof limits] || limits.free;
} 