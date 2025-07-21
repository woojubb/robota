/**
 * Firebase Admin SDK - Browser Safe Wrapper
 * 
 * This file provides a safe interface for Firebase Admin operations
 * that can be used in both server and client contexts without causing
 * Node.js module bundling issues.
 */

export interface AuthUser {
    uid: string;
    email?: string;
    emailVerified: boolean;
    customClaims?: Record<string, any>;
}

export interface FirebaseAdminService {
    verifyIdToken(idToken: string): Promise<AuthUser>;
    getUser(uid: string): Promise<AuthUser>;
}

/**
 * Get Firebase Admin service instance
 * Only works on server-side, returns null on client-side
 */
export async function getFirebaseAdmin(): Promise<FirebaseAdminService | null> {
    // Only available on server-side
    if (typeof window !== 'undefined') {
        return null;
    }

    try {
        // Dynamic import only on server-side
        const { auth } = await import('./admin');

        return {
            async verifyIdToken(idToken: string): Promise<AuthUser> {
                const decodedToken = await auth.verifyIdToken(idToken);
                return {
                    uid: decodedToken.uid,
                    email: decodedToken.email,
                    emailVerified: decodedToken.email_verified || false,
                    customClaims: decodedToken
                };
            },

            async getUser(uid: string): Promise<AuthUser> {
                const userRecord = await auth.getUser(uid);
                return {
                    uid: userRecord.uid,
                    email: userRecord.email,
                    emailVerified: userRecord.emailVerified,
                    customClaims: userRecord.customClaims || {}
                };
            }
        };
    } catch (error) {
        console.error('Firebase Admin not available:', error);
        return null;
    }
}

/**
 * Mock Firebase Admin service for development/fallback
 */
export function getMockFirebaseAdmin(): FirebaseAdminService {
    return {
        async verifyIdToken(idToken: string): Promise<AuthUser> {
            // Mock verification
            return {
                uid: 'mock-user-id',
                email: 'mock@example.com',
                emailVerified: true,
                customClaims: { subscription: 'pro' }
            };
        },

        async getUser(uid: string): Promise<AuthUser> {
            // Mock user data
            return {
                uid,
                email: 'mock@example.com',
                emailVerified: true,
                customClaims: { subscription: 'pro' }
            };
        }
    };
} 