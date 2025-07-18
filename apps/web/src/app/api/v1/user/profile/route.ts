import { NextRequest } from 'next/server';
import { withAuth, createSuccessResponse, createErrorResponse } from '@/lib/auth-middleware';
import { db } from '@/lib/firebase/config';
import { doc, getDoc, updateDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import { UserProfile } from '@/types/auth';
import { UserExtended } from '@/types/user-credit';
import { userCache, cacheKeys } from '@/lib/cache';

/**
 * Get user profile
 * GET /api/v1/user/profile
 */
export const GET = withAuth(async (request: NextRequest, { uid }) => {
    console.log('Profile API GET: Starting for user:', uid);

    try {
        // Check cache first
        console.log('Profile API: Checking cache...');
        const cacheKey = cacheKeys.userProfile(uid);
        const cachedProfile = userCache.get(cacheKey);
        if (cachedProfile) {
            console.log('Profile API: Cache hit, returning cached data');
            return createSuccessResponse(cachedProfile);
        }
        console.log('Profile API: Cache miss, fetching from Firestore');

        // Get user profile from Firestore
        console.log('Profile API: Fetching user document from Firestore...');

        let userDoc;
        let userData = null;
        let extendedData = null;

        try {
            userDoc = await getDoc(doc(db, 'users', uid));
            console.log('Profile API: User document exists:', userDoc.exists());

            if (userDoc.exists()) {
                userData = userDoc.data();
                console.log('Profile API: User data keys:', Object.keys(userData || {}));

                // Get extended user data
                console.log('Profile API: Fetching extended user data...');
                const extendedDoc = await getDoc(doc(db, 'users_extended', uid));
                extendedData = extendedDoc.exists() ? extendedDoc.data() : null;
                console.log('Profile API: Extended data exists:', !!extendedData);
            }
        } catch (firestoreError) {
            console.error('Profile API: Firestore connection error:', firestoreError);
            console.log('Profile API: Returning default profile due to Firestore connection issue');

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
            console.log('Profile API: User document not found, creating default profile');

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

            console.log('Profile API: Returning default profile');

            // Cache the default profile for a shorter time
            userCache.set(cacheKey, defaultProfile, 1 * 60 * 1000); // 1 minute

            return createSuccessResponse(defaultProfile);
        }

        console.log('Profile API: Processing user document data...');

        // Safely convert dates
        let createdAt: Date;
        let updatedAt: Date;

        try {
            createdAt = userData?.createdAt?.toDate() || new Date();
        } catch (error) {
            console.warn('Profile API: Error converting createdAt, using current date:', error);
            createdAt = new Date();
        }

        try {
            updatedAt = userData?.updatedAt?.toDate() || new Date();
        } catch (error) {
            console.warn('Profile API: Error converting updatedAt, using current date:', error);
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

        console.log('Profile API: Profile assembled successfully');

        // Cache the result for 5 minutes
        userCache.set(cacheKey, profile, 5 * 60 * 1000);

        return createSuccessResponse(profile);
    } catch (error) {
        console.error('Profile API: Error occurred:', error);
        console.error('Profile API: Error stack:', error instanceof Error ? error.stack : 'No stack trace');

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

        console.log('Profile API: Returning fallback profile due to error');
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
        console.error('Error updating user profile:', error);
        return createErrorResponse('Failed to update user profile', 500);
    }
});

/**
 * Create user profile
 * POST /api/v1/user/profile
 */
export const POST = withAuth(async (request: NextRequest, { uid }) => {
    console.log('Profile API POST: Starting profile creation for user:', uid);

    try {
        const body = await request.json();
        const { email, displayName } = body;
        console.log('Profile API POST: Request body:', { email, displayName });

        // Check if user already exists
        const existingDoc = await getDoc(doc(db, 'users', uid));
        if (existingDoc.exists()) {
            console.log('Profile API POST: User profile already exists');
            return createErrorResponse('User profile already exists', 409, 'USER_EXISTS');
        }

        console.log('Profile API POST: Creating new user profile...');

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
        console.log('Profile API POST: Basic profile created');

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
        console.log('Profile API POST: Extended profile created');

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

        console.log('Profile API POST: Profile creation successful');
        return createSuccessResponse(responseData, 'User profile created successfully', 201);
    } catch (error) {
        console.error('Profile API POST: Error creating user profile:', error);
        console.error('Profile API POST: Error stack:', error instanceof Error ? error.stack : 'No stack trace');
        return createErrorResponse(
            `Failed to create user profile: ${error instanceof Error ? error.message : 'Unknown error'}`,
            500,
            'PROFILE_CREATE_ERROR'
        );
    }
}); 