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
    try {
        // Check cache first
        const cacheKey = cacheKeys.userProfile(uid);
        const cachedProfile = userCache.get(cacheKey);
        if (cachedProfile) {
            return createSuccessResponse(cachedProfile);
        }

        // Get user profile from Firestore
        const userDoc = await getDoc(doc(db, 'users', uid));

        if (!userDoc.exists()) {
            return createErrorResponse('User profile not found', 404, 'USER_NOT_FOUND');
        }

        const userData = userDoc.data();

        // Get extended user data
        const extendedDoc = await getDoc(doc(db, 'users_extended', uid));
        const extendedData = extendedDoc.exists() ? extendedDoc.data() : null;

        // Combine basic profile and extended data
        const profile = {
            uid,
            email: userData.email,
            displayName: userData.displayName,
            photoURL: userData.photoURL,
            role: userData.role || 'user',
            createdAt: userData.createdAt?.toDate() || new Date(),
            updatedAt: userData.updatedAt?.toDate() || new Date(),
            preferences: userData.preferences || {
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

        // Cache the result for 5 minutes
        userCache.set(cacheKey, profile, 5 * 60 * 1000);

        return createSuccessResponse(profile);
    } catch (error) {
        console.error('Error fetching user profile:', error);
        return createErrorResponse('Failed to fetch user profile', 500);
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
 * Create user profile (for internal use, e.g., after sign up)
 * POST /api/v1/user/profile
 */
export const POST = withAuth(async (request: NextRequest, { uid }) => {
    try {
        const body = await request.json();
        const { email, displayName } = body;

        // Check if user already exists
        const existingDoc = await getDoc(doc(db, 'users', uid));
        if (existingDoc.exists()) {
            return createErrorResponse('User profile already exists', 409, 'USER_EXISTS');
        }

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
                language: navigator.language.startsWith('ko') ? 'ko' : 'en',
                notifications: true,
            },
        };

        await setDoc(doc(db, 'users', uid), userProfile);

        // Create extended user record
        const extendedProfile = {
            uid,
            email: email || '',
            display_name: displayName || '',
            subscription_plan: 'free',
            total_credits: 50, // Initial free credits
            used_credits: 0,
            subscription_credits: 50,
            purchased_credits: 0,
            usage_this_month: 0,
            last_credit_update: serverTimestamp(),
            created_at: serverTimestamp(),
            updated_at: serverTimestamp(),
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
            locale: navigator.language.startsWith('ko') ? 'ko' : 'en',
        };

        await setDoc(doc(db, 'users_extended', uid), extendedProfile);

        return createSuccessResponse({
            ...userProfile,
            ...extendedProfile,
            createdAt: new Date(),
            updatedAt: new Date(),
        }, 'User profile created successfully', 201);
    } catch (error) {
        console.error('Error creating user profile:', error);
        return createErrorResponse('Failed to create user profile', 500);
    }
}); 