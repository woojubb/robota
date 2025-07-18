import {
    createUserWithEmailAndPassword,
    signInWithEmailAndPassword,
    signInWithPopup,
    signOut as firebaseSignOut,
    sendPasswordResetEmail,
    updateProfile,
    GoogleAuthProvider,
    GithubAuthProvider,
    User as FirebaseUser,
    UserCredential,
    reauthenticateWithCredential,
    EmailAuthProvider,
    updatePassword,
} from 'firebase/auth';
import { auth } from './config';
import { User } from '@/types/auth';

// Convert Firebase user to our User type
export const convertFirebaseUser = (firebaseUser: FirebaseUser): User => {
    return {
        ...firebaseUser,
        uid: firebaseUser.uid,
        email: firebaseUser.email,
        displayName: firebaseUser.displayName,
        photoURL: firebaseUser.photoURL,
        emailVerified: firebaseUser.emailVerified,
    };
};

// Sign up with email and password
export const signUp = async (
    email: string,
    password: string,
    displayName: string
): Promise<UserCredential> => {
    try {
        const userCredential = await createUserWithEmailAndPassword(auth, email, password);
        const { user } = userCredential;

        // Update display name
        await updateProfile(user, { displayName });

        // Note: User profile creation in Firestore should be handled by 
        // a Cloud Function or backend API triggered by user creation

        return userCredential;
    } catch (error: any) {
        console.error('Sign up error:', error);
        if (error.code === 'auth/email-already-in-use') {
            throw new Error('This email is already registered');
        } else if (error.code === 'auth/weak-password') {
            throw new Error('Password should be at least 6 characters');
        } else if (error.code === 'auth/invalid-email') {
            throw new Error('Invalid email address');
        }
        throw error;
    }
};

// Sign in with email and password
export const signIn = async (email: string, password: string): Promise<UserCredential> => {
    try {
        return await signInWithEmailAndPassword(auth, email, password);
    } catch (error: any) {
        console.error('Sign in error:', error);
        if (error.code === 'auth/user-not-found') {
            throw new Error('No user found with this email');
        } else if (error.code === 'auth/wrong-password') {
            throw new Error('Incorrect password');
        } else if (error.code === 'auth/invalid-email') {
            throw new Error('Invalid email address');
        }
        throw error;
    }
};

// Sign in with Google
export const signInWithGoogle = async (): Promise<UserCredential> => {
    try {
        const provider = new GoogleAuthProvider();
        return await signInWithPopup(auth, provider);
    } catch (error: any) {
        console.error('Google sign in error:', error);
        if (error.code === 'auth/popup-closed-by-user') {
            throw new Error('Sign in was cancelled');
        }
        throw error;
    }
};

// Sign in with GitHub
export const signInWithGitHub = async (): Promise<UserCredential> => {
    try {
        const provider = new GithubAuthProvider();
        return await signInWithPopup(auth, provider);
    } catch (error: any) {
        console.error('GitHub sign in error:', error);
        if (error.code === 'auth/popup-closed-by-user') {
            throw new Error('Sign in was cancelled');
        }
        throw error;
    }
};

// Sign out
export const signOut = async (): Promise<void> => {
    try {
        await firebaseSignOut(auth);
    } catch (error: any) {
        console.error('Sign out error:', error);
        throw new Error('Failed to sign out');
    }
};

// Reset password
export const resetPassword = async (email: string): Promise<void> => {
    try {
        await sendPasswordResetEmail(auth, email);
    } catch (error: any) {
        console.error('Password reset error:', error);
        if (error.code === 'auth/user-not-found') {
            throw new Error('No user found with this email');
        } else if (error.code === 'auth/invalid-email') {
            throw new Error('Invalid email address');
        }
        throw error;
    }
};

// Change password
export const changePassword = async (
    currentPassword: string,
    newPassword: string
): Promise<void> => {
    try {
        const user = auth.currentUser;
        if (!user || !user.email) {
            throw new Error('No user is currently signed in');
        }

        // Re-authenticate user
        const credential = EmailAuthProvider.credential(user.email, currentPassword);
        await reauthenticateWithCredential(user, credential);

        // Update password
        await updatePassword(user, newPassword);
    } catch (error: any) {
        console.error('Change password error:', error);
        if (error.code === 'auth/wrong-password') {
            throw new Error('Current password is incorrect');
        } else if (error.code === 'auth/weak-password') {
            throw new Error('New password should be at least 6 characters');
        }
        throw error;
    }
}; 