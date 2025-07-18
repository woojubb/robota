import { User as FirebaseUser } from 'firebase/auth';

export interface User extends FirebaseUser {
    displayName: string | null;
    email: string | null;
    photoURL: string | null;
    uid: string;
}

export interface UserProfile {
    uid: string;
    email: string;
    displayName: string;
    photoURL?: string;
    createdAt: Date;
    updatedAt: Date;
    subscription?: {
        plan: 'free' | 'pro' | 'enterprise';
        status: 'active' | 'canceled' | 'past_due';
        currentPeriodEnd: Date;
    };
    preferences?: {
        theme: 'light' | 'dark' | 'system';
        language: string;
        notifications: boolean;
    };
}

import { UserExtended, UserCreditSummary } from './user-credit';

export interface AuthContextType {
    user: User | null;
    userProfile: UserProfile | null;
    userExtended: UserExtended | null;
    creditSummary: UserCreditSummary | null;
    loading: boolean;
    signIn: (email: string, password: string) => Promise<void>;
    signUp: (email: string, password: string, displayName: string) => Promise<void>;
    signInWithGoogle: () => Promise<void>;
    signInWithGitHub: () => Promise<void>;
    signOut: () => Promise<void>;
    resetPassword: (email: string) => Promise<void>;
    updateProfile: (updates: Partial<UserProfile>) => Promise<void>;
    changePassword: (currentPassword: string, newPassword: string) => Promise<void>;
    refreshProfile: () => Promise<void>;
}

export interface AuthError {
    code: string;
    message: string;
} 