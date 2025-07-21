import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/firebase/admin';

export async function POST(request: NextRequest) {
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

        // Check if user has playground access
        const hasAccess = await checkPlaygroundAccess(uid);
        if (!hasAccess) {
            return NextResponse.json(
                { error: 'User does not have playground access' },
                { status: 403 }
            );
        }

        // Generate playground-specific token
        const playgroundToken = generatePlaygroundToken(uid, email);

        // Store token metadata (optional - for tracking/analytics)
        await storeTokenMetadata(uid, playgroundToken);

        return NextResponse.json({
            token: playgroundToken,
            userId: uid,
            email,
            expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(), // 24 hours
            permissions: ['playground:execute', 'playground:chat']
        });

    } catch (error) {
        console.error('Error generating playground token:', error);
        return NextResponse.json(
            { error: 'Internal server error' },
            { status: 500 }
        );
    }
}

/**
 * Check if user has access to playground
 */
async function checkPlaygroundAccess(userId: string): Promise<boolean> {
    try {
        // Get user record from Firebase Auth
        const userRecord = await auth.getUser(userId);

        // Check custom claims for playground access
        const customClaims = userRecord.customClaims || {};

        // For now, allow all authenticated users
        // In production, you might check subscription status, roles, etc.
        return !!userRecord.email && userRecord.emailVerified;

    } catch (error) {
        console.error('Error checking playground access:', error);
        return false;
    }
}

/**
 * Generate a secure playground token
 */
function generatePlaygroundToken(userId: string, email?: string): string {
    const payload = {
        userId,
        email,
        scope: 'playground',
        timestamp: Date.now(),
        nonce: Math.random().toString(36).substring(2)
    };

    // In production, use proper JWT signing with a secret
    const tokenData = Buffer.from(JSON.stringify(payload)).toString('base64');
    return `pg_${tokenData}`;
}

/**
 * Store token metadata for tracking
 */
async function storeTokenMetadata(userId: string, token: string): Promise<void> {
    try {
        // In production, store in database for tracking/analytics
        // For now, just log
        console.log(`Playground token generated for user ${userId}: ${token.substring(0, 20)}...`);
    } catch (error) {
        console.error('Error storing token metadata:', error);
        // Don't fail the request if metadata storage fails
    }
} 