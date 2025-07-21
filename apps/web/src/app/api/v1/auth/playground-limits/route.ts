import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/firebase/admin';

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
        const { uid } = decodedToken;

        // Get user limits based on their subscription/role
        const limits = await getUserPlaygroundLimits(uid);

        return NextResponse.json(limits);

    } catch (error) {
        console.error('Error fetching playground limits:', error);

        if (error instanceof Error && error.message.includes('Firebase ID token')) {
            return NextResponse.json(
                { error: 'Invalid Firebase token' },
                { status: 401 }
            );
        }

        return NextResponse.json(
            { error: 'Internal server error' },
            { status: 500 }
        );
    }
}

/**
 * Get playground limits for a user
 */
async function getUserPlaygroundLimits(userId: string) {
    try {
        // Get user record from Firebase Auth
        const userRecord = await auth.getUser(userId);
        const customClaims = userRecord.customClaims || {};

        // Check subscription level from custom claims
        const subscriptionLevel = customClaims.subscription || 'free';

        // Define limits based on subscription level
        const limits = {
            free: {
                dailyExecutions: 10,
                maxConcurrentSessions: 1,
                allowedProviders: ['openai'],
                maxTokens: 1000,
                features: {
                    streaming: false,
                    tools: false,
                    customTemplates: false
                }
            },
            pro: {
                dailyExecutions: 100,
                maxConcurrentSessions: 3,
                allowedProviders: ['openai', 'anthropic', 'google'],
                maxTokens: 4000,
                features: {
                    streaming: true,
                    tools: true,
                    customTemplates: true
                }
            },
            enterprise: {
                dailyExecutions: 1000,
                maxConcurrentSessions: 10,
                allowedProviders: ['openai', 'anthropic', 'google'],
                maxTokens: 16000,
                features: {
                    streaming: true,
                    tools: true,
                    customTemplates: true
                }
            }
        };

        // Get current usage (in production, fetch from database)
        const currentUsage = await getCurrentUsage(userId);

        return {
            ...limits[subscriptionLevel as keyof typeof limits],
            currentUsage,
            subscription: subscriptionLevel,
            userId
        };

    } catch (error) {
        console.error('Error getting user limits:', error);

        // Return default free tier limits on error
        return {
            dailyExecutions: 10,
            maxConcurrentSessions: 1,
            allowedProviders: ['openai'],
            maxTokens: 1000,
            features: {
                streaming: false,
                tools: false,
                customTemplates: false
            },
            currentUsage: {
                dailyExecutions: 0,
                activeSessions: 0,
                tokensUsed: 0
            },
            subscription: 'free',
            userId
        };
    }
}

/**
 * Get current usage for a user
 */
async function getCurrentUsage(userId: string) {
    try {
        // In production, fetch from database
        // For now, return mock data
        return {
            dailyExecutions: Math.floor(Math.random() * 5), // Mock usage
            activeSessions: 0,
            tokensUsed: Math.floor(Math.random() * 500)
        };

    } catch (error) {
        console.error('Error getting current usage:', error);
        return {
            dailyExecutions: 0,
            activeSessions: 0,
            tokensUsed: 0
        };
    }
} 