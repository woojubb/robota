import {
    signInWithEmailAndPassword,
    createUserWithEmailAndPassword,
    signInWithPopup,
    GoogleAuthProvider,
    GithubAuthProvider,
    signOut as firebaseSignOut,
    sendPasswordResetEmail,
    updateProfile as firebaseUpdateProfile,
    User as FirebaseUser,
} from 'firebase/auth';
import { doc, setDoc, getDoc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { auth, db } from './config';
import { User, UserProfile, AuthError } from '@/types/auth';

// Configure auth providers
const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({
    prompt: 'select_account',
});

const githubProvider = new GithubAuthProvider();
githubProvider.setCustomParameters({
    prompt: 'select_account',
});

// Helper function to convert Firebase user to our User type
export const convertFirebaseUser = (firebaseUser: FirebaseUser): User => {
    return {
        ...firebaseUser,
        displayName: firebaseUser.displayName,
        email: firebaseUser.email,
        photoURL: firebaseUser.photoURL,
        uid: firebaseUser.uid,
    };
};

// Helper function to handle auth errors
export const handleAuthError = (error: any): AuthError => {
    const errorMessages: Record<string, string> = {
        'auth/user-not-found': '등록되지 않은 이메일입니다.',
        'auth/wrong-password': '비밀번호가 올바르지 않습니다.',
        'auth/email-already-in-use': '이미 사용 중인 이메일입니다.',
        'auth/weak-password': '비밀번호는 6자 이상이어야 합니다.',
        'auth/invalid-email': '유효하지 않은 이메일 형식입니다.',
        'auth/too-many-requests': '요청이 너무 많습니다. 잠시 후 다시 시도해주세요.',
        'auth/network-request-failed': '네트워크 연결을 확인해주세요.',
    };

    return {
        code: error.code || 'auth/unknown-error',
        message: errorMessages[error.code] || error.message || '알 수 없는 오류가 발생했습니다.',
    };
};

// Create or update user profile in Firestore
export const createUserProfile = async (user: User, additionalData?: Partial<UserProfile>): Promise<UserProfile> => {
    const userDocRef = doc(db, 'users', user.uid);
    const userDoc = await getDoc(userDocRef);

    if (!userDoc.exists()) {
        const userProfile: UserProfile = {
            uid: user.uid,
            email: user.email || '',
            displayName: user.displayName || '',
            photoURL: user.photoURL || undefined,
            createdAt: new Date(),
            updatedAt: new Date(),
            preferences: {
                theme: 'system',
                language: 'ko',
                notifications: true,
            },
            ...additionalData,
        };

        try {
            await setDoc(userDocRef, {
                ...userProfile,
                createdAt: serverTimestamp(),
                updatedAt: serverTimestamp(),
            });
            return userProfile;
        } catch (error) {
            console.error('Error creating user profile:', error);
            throw error;
        }
    }

    return userDoc.data() as UserProfile;
};

// Get user profile from Firestore
export const getUserProfile = async (uid: string): Promise<UserProfile | null> => {
    try {
        const userDocRef = doc(db, 'users', uid);
        const userDoc = await getDoc(userDocRef);

        if (userDoc.exists()) {
            const data = userDoc.data();
            return {
                ...data,
                createdAt: data.createdAt?.toDate() || new Date(),
                updatedAt: data.updatedAt?.toDate() || new Date(),
            } as UserProfile;
        }

        return null;
    } catch (error) {
        console.error('Error getting user profile:', error);
        return null;
    }
};

// Update user profile in Firestore
export const updateUserProfile = async (uid: string, updates: Partial<UserProfile>): Promise<void> => {
    try {
        const userDocRef = doc(db, 'users', uid);
        await updateDoc(userDocRef, {
            ...updates,
            updatedAt: serverTimestamp(),
        });
    } catch (error) {
        console.error('Error updating user profile:', error);
        throw error;
    }
};

// Authentication methods
export const signIn = async (email: string, password: string): Promise<User> => {
    try {
        const result = await signInWithEmailAndPassword(auth, email, password);
        return convertFirebaseUser(result.user);
    } catch (error) {
        throw handleAuthError(error);
    }
};

export const signUp = async (email: string, password: string, displayName: string): Promise<User> => {
    try {
        const result = await createUserWithEmailAndPassword(auth, email, password);
        const user = convertFirebaseUser(result.user);

        // Update display name
        await firebaseUpdateProfile(result.user, { displayName });

        // Create user profile in Firestore
        await createUserProfile(user, { displayName });

        return user;
    } catch (error) {
        throw handleAuthError(error);
    }
};

export const signInWithGoogle = async (): Promise<User> => {
    try {
        const result = await signInWithPopup(auth, googleProvider);
        const user = convertFirebaseUser(result.user);

        // Create or update user profile
        await createUserProfile(user);

        return user;
    } catch (error) {
        throw handleAuthError(error);
    }
};

export const signInWithGitHub = async (): Promise<User> => {
    try {
        const result = await signInWithPopup(auth, githubProvider);
        const user = convertFirebaseUser(result.user);

        // Create or update user profile
        await createUserProfile(user);

        return user;
    } catch (error) {
        throw handleAuthError(error);
    }
};

export const signOut = async (): Promise<void> => {
    try {
        await firebaseSignOut(auth);
    } catch (error) {
        throw handleAuthError(error);
    }
};

export const resetPassword = async (email: string): Promise<void> => {
    try {
        await sendPasswordResetEmail(auth, email);
    } catch (error) {
        throw handleAuthError(error);
    }
}; 