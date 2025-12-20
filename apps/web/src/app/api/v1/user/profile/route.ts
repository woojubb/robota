import { NextRequest } from 'next/server';
import { withAuth, createSuccessResponse, createErrorResponse } from '@/lib/auth-middleware';
import { db } from '@/lib/firebase/config';
import { doc, getDoc, updateDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import { UserProfile } from '@/types/auth';
import { UserExtended } from '@/types/user-credit';
import { userCache, cacheKeys } from '@/lib/cache';
import { WebLogger } from '@/lib/web-logger';

/**
 * Get user profile
 * GET /api/v1/user/profile
 */
export const GET = withAuth(async (request: NextRequest, { uid }) => {
    WebLogger.debug('Profile API GET: start', { uid });

    try {
        // Check cache first
        WebLogger.debug('Profile API: checking cache', { uid });
        const cacheKey = cacheKeys.userProfile(uid);
        const cachedProfile = userCache.get(cacheKey);
        if (cachedProfile) {
            WebLogger.debug('Profile API: cache hit', { uid });
            return createSuccessResponse(cachedProfile);
        }
        WebLogger.debug('Profile API: cache miss, fetching from Firestore', { uid });

        // Get user profile from Firestore
        WebLogger.debug('Profile API: fetching user document from Firestore', { uid });

        let userDoc;
        let userData = null;
        let extendedData = null;

        try {
            userDoc = await getDoc(doc(db, 'users', uid));
            WebLogger.debug('Profile API: user document fetched', { uid, exists: userDoc.exists() });

            if (userDoc.exists()) {
                userData = userDoc.data();
                WebLogger.debug('Profile API: user data keys', { uid, keys: Object.keys(userData || {}) });

                // Get extended user data
                WebLogger.debug('Profile API: fetching extended user data', { uid });
                const extendedDoc = await getDoc(doc(db, 'users_extended', uid));
                extendedData = extendedDoc.exists() ? extendedDoc.data() : null;
                WebLogger.debug('Profile API: extended data fetched', { uid, exists: !!extendedData });
            }
        } catch (firestoreError) {
            WebLogger.error('Profile API: Firestore connection error', { uid, error: firestoreError instanceof Error ? firestoreError.message : String(firestoreError) });
            WebLogger.warn('Profile API: returning default profile due to Firestore connectivity issue', { uid });

            // Return default profile when Firestore is unavailable
            const defaultProfile = {
                uid,
                email: '', // Will be populated from JWT token if available
                displayName: 'User',
                photoURL: null,
                role: 'user',
                createdAt: new Date(),
                updatedAt: new Date(),
                preferences: {
                    theme: 'system',
                    language: 'ko',
                    notifications: true,
                },
                // Extended data defaults
                subscription_plan: 'free',
                total_credits: 100,
                used_credits: 0,
                subscription_credits: 100,
                purchased_credits: 0,
            };

            // Cache the default profile for a shorter time
            userCache.set(cacheKey, defaultProfile, 30 * 1000); // 30 seconds

            return createSuccessResponse(defaultProfile, 'Default profile returned due to database connectivity issue');
        }

        if (!userDoc || !userDoc.exists()) {
            WebLogger.warn('Profile API: user document not found, returning default profile', { uid });

            // Create a default user profile if it doesn't exist
            const defaultProfile = {
                uid,
                email: '',
                displayName: '',
                photoURL: null,
                role: 'user',
                createdAt: new Date(),
                updatedAt: new Date(),
                preferences: {
                    theme: 'system',
                    language: 'ko',
                    notifications: true,
                },
                // Extended data defaults
                subscription_plan: 'free',
                total_credits: 100,
                used_credits: 0,
                subscription_credits: 100,
                purchased_credits: 0,
            };

            WebLogger.debug('Profile API: returning default profile', { uid });

            // Cache the default profile for a shorter time
            userCache.set(cacheKey, defaultProfile, 1 * 60 * 1000); // 1 minute

            return createSuccessResponse(defaultProfile);
        }

        WebLogger.debug('Profile API: processing user document data', { uid });

        // Safely convert dates
        let createdAt: Date;
        let updatedAt: Date;

        try {
            createdAt = userData?.createdAt?.toDate() || new Date();
        } catch (error) {
            WebLogger.warn('Profile API: error converting createdAt, using current date', { uid, error: error instanceof Error ? error.message : String(error) });
            createdAt = new Date();
        }

        try {
            updatedAt = userData?.updatedAt?.toDate() || new Date();
        } catch (error) {
            WebLogger.warn('Profile API: error converting updatedAt, using current date', { uid, error: error instanceof Error ? error.message : String(error) });
            updatedAt = new Date();
        }

        // Combine basic profile and extended data
        const profile = {
            uid,
            email: userData?.email || '',
            displayName: userData?.displayName || '',
            photoURL: userData?.photoURL || null,
            role: userData?.role || 'user',
            createdAt,
            updatedAt,
            preferences: userData?.preferences || {
                theme: 'system',
                language: 'ko',
                notifications: true,
            },
            // Extended data
            subscription_plan: extendedData?.subscription_plan || 'free',
            total_credits: extendedData?.total_credits || 100,
            used_credits: extendedData?.used_credits || 0,
            subscription_credits: extendedData?.subscription_credits || 100,
            purchased_credits: extendedData?.purchased_credits || 0,
        };

        WebLogger.debug('Profile API: profile assembled successfully', { uid });

        // Cache the result for 5 minutes
        userCache.set(cacheKey, profile, 5 * 60 * 1000);

        return createSuccessResponse(profile);
    } catch (error) {
        WebLogger.error('Profile API: error occurred', { uid, error: error instanceof Error ? error.message : String(error) });

        // Return default profile as last resort
        const fallbackProfile = {
            uid,
            email: '',
            displayName: 'User',
            photoURL: null,
            role: 'user',
            createdAt: new Date(),
            updatedAt: new Date(),
            preferences: {
                theme: 'system',
                language: 'ko',
                notifications: true,
            },
            subscription_plan: 'free',
            total_credits: 100,
            used_credits: 0,
            subscription_credits: 100,
            purchased_credits: 0,
        };

        WebLogger.warn('Profile API: returning fallback profile due to error', { uid });
        return createSuccessResponse(fallbackProfile, 'Fallback profile returned due to error');
    }
});

/**
 * Update user profile
 * PUT /api/v1/user/profile
 */
export const PUT = withAuth(async (request: NextRequest, { uid }) => {
    try {
        const body = await request.json();

        // Validate input
        const allowedFields = ['displayName', 'photoURL', 'preferences'];
        const updates: any = {
            updatedAt: serverTimestamp(),
        };

        for (const field of allowedFields) {
            if (field in body) {
                updates[field] = body[field];
            }
        }

        // Update user profile in Firestore
        await updateDoc(doc(db, 'users', uid), updates);

        // Invalidate cache
        const cacheKey = cacheKeys.userProfile(uid);
        userCache.delete(cacheKey);

        // Fetch updated profile
        const userDoc = await getDoc(doc(db, 'users', uid));
        const userData = userDoc.data();

        // Get extended data
        const extendedDoc = await getDoc(doc(db, 'users_extended', uid));
        const extendedData = extendedDoc.exists() ? extendedDoc.data() : null;

        const profile = {
            uid,
            email: userData?.email,
            displayName: userData?.displayName,
            photoURL: userData?.photoURL,
            role: userData?.role || 'user',
            createdAt: userData?.createdAt?.toDate() || new Date(),
            updatedAt: userData?.updatedAt?.toDate() || new Date(),
            preferences: userData?.preferences || {
                theme: 'system',
                language: 'ko',
                notifications: true,
            },
            // Extended data
            subscription_plan: extendedData?.subscription_plan || 'free',
            total_credits: extendedData?.total_credits || 0,
            used_credits: extendedData?.used_credits || 0,
            subscription_credits: extendedData?.subscription_credits || 0,
            purchased_credits: extendedData?.purchased_credits || 0,
        };

        // Cache the updated profile
        userCache.set(cacheKey, profile, 5 * 60 * 1000);

        return createSuccessResponse(profile, 'Profile updated successfully');
    } catch (error) {
        WebLogger.error('Error updating user profile', { uid, error: error instanceof Error ? error.message : String(error) });
        return createErrorResponse('Failed to update user profile', 500);
    }
});

/**
 * Create user profile
 * POST /api/v1/user/profile
 */
export const POST = withAuth(async (request: NextRequest, { uid }) => {
    WebLogger.debug('Profile API POST: start profile creation', { uid });

    try {
        const body = await request.json();
        const { email, displayName } = body;
        WebLogger.debug('Profile API POST: request body received', { uid, hasEmail: !!email, hasDisplayName: !!displayName });

        // Check if user already exists
        const existingDoc = await getDoc(doc(db, 'users', uid));
        if (existingDoc.exists()) {
            WebLogger.debug('Profile API POST: user profile already exists', { uid });
            return createErrorResponse('User profile already exists', 409, 'USER_EXISTS');
        }

        WebLogger.debug('Profile API POST: creating new user profile', { uid });

        // Create basic user profile
        const userProfile = {
            uid,
            email: email || '',
            displayName: displayName || '',
            photoURL: null,
            role: 'user',
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
            preferences: {
                theme: 'system',
                language: 'ko', // Default to Korean
                notifications: true,
            },
        };

        await setDoc(doc(db, 'users', uid), userProfile);
        WebLogger.debug('Profile API POST: basic profile created', { uid });

        // Create extended user record
        const extendedProfile = {
            uid,
            email: email || '',
            display_name: displayName || '',
            subscription_plan: 'free',
            total_credits: 100, // Initial free credits
            used_credits: 0,
            subscription_credits: 100,
            purchased_credits: 0,
            usage_this_month: 0,
            last_credit_update: serverTimestamp(),
            created_at: serverTimestamp(),
            updated_at: serverTimestamp(),
            timezone: 'Asia/Seoul', // Default timezone
            locale: 'ko', // Default locale
        };

        await setDoc(doc(db, 'users_extended', uid), extendedProfile);
        WebLogger.debug('Profile API POST: extended profile created', { uid });

        const responseData = {
            uid,
            email: email || '',
            displayName: displayName || '',
            photoURL: null,
            role: 'user',
            createdAt: new Date(),
            updatedAt: new Date(),
            preferences: {
                theme: 'system',
                language: 'ko',
                notifications: true,
            },
            subscription_plan: 'free',
            total_credits: 100,
            used_credits: 0,
            subscription_credits: 100,
            purchased_credits: 0,
        };

        WebLogger.info('Profile API POST: profile creation successful', { uid });
        return createSuccessResponse(responseData, 'User profile created successfully', 201);
    } catch (error) {
        WebLogger.error('Profile API POST: error creating user profile', { uid, error: error instanceof Error ? error.message : String(error) });
        return createErrorResponse(
            `Failed to create user profile: ${error instanceof Error ? error.message : 'Unknown error'}`,
            500,
            'PROFILE_CREATE_ERROR'
        );
    }
}); 