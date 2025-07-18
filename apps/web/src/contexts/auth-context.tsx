'use client';

import React, { createContext, useContext, useEffect, useState } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { auth } from '@/lib/firebase/config';
import {
    signIn as authSignIn,
    signUp as authSignUp,
    signInWithGoogle as authSignInWithGoogle,
    signInWithGitHub as authSignInWithGitHub,
    signOut as authSignOut,
    resetPassword as authResetPassword,
    changePassword as authChangePassword,
    convertFirebaseUser,
    getUserProfile,
    updateUserProfile,
} from '@/lib/firebase/auth-service';
import { User, UserProfile, AuthContextType } from '@/types/auth';
import { useToast } from '@/hooks/use-toast';
import { trackEvents } from '@/lib/analytics/google-analytics';

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export interface AuthProviderProps {
    children: React.ReactNode;
}

export const AuthProvider: React.FC<AuthProviderProps> = ({ children }) => {
    const [user, setUser] = useState<User | null>(null);
    const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
    const [loading, setLoading] = useState(true);
    const { toast } = useToast();

    // Load user profile when user changes
    const loadUserProfile = async (user: User) => {
        try {
            const profile = await getUserProfile(user.uid);
            setUserProfile(profile);
        } catch (error) {
            console.error('Error loading user profile:', error);
            toast({
                title: "프로필 로드 실패",
                description: "사용자 프로필을 불러오는데 실패했습니다.",
                variant: "destructive",
            });
        }
    };

    // Authentication state listener
    useEffect(() => {
        const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
            if (firebaseUser) {
                const user = convertFirebaseUser(firebaseUser);
                setUser(user);
                await loadUserProfile(user);
            } else {
                setUser(null);
                setUserProfile(null);
            }
            setLoading(false);
        });

        return () => unsubscribe();
    }, [toast]);

    // Authentication methods
    const signIn = async (email: string, password: string): Promise<void> => {
        try {
            setLoading(true);
            await authSignIn(email, password);
            trackEvents.signIn('email');
            toast({
                title: "로그인 성공",
                description: "환영합니다!",
            });
        } catch (error: any) {
            toast({
                title: "로그인 실패",
                description: error.message,
                variant: "destructive",
            });
            throw error;
        } finally {
            setLoading(false);
        }
    };

    const signUp = async (email: string, password: string, displayName: string): Promise<void> => {
        try {
            setLoading(true);
            await authSignUp(email, password, displayName);
            trackEvents.signUp('email');
            toast({
                title: "회원가입 성공",
                description: "계정이 성공적으로 생성되었습니다.",
            });
        } catch (error: any) {
            toast({
                title: "회원가입 실패",
                description: error.message,
                variant: "destructive",
            });
            throw error;
        } finally {
            setLoading(false);
        }
    };

    const signInWithGoogle = async (): Promise<void> => {
        try {
            setLoading(true);
            await authSignInWithGoogle();
            trackEvents.signIn('google');
            toast({
                title: "Google 로그인 성공",
                description: "환영합니다!",
            });
        } catch (error: any) {
            toast({
                title: "Google 로그인 실패",
                description: error.message,
                variant: "destructive",
            });
            throw error;
        } finally {
            setLoading(false);
        }
    };

    const signInWithGitHub = async (): Promise<void> => {
        try {
            setLoading(true);
            await authSignInWithGitHub();
            trackEvents.signIn('github');
            toast({
                title: "GitHub 로그인 성공",
                description: "환영합니다!",
            });
        } catch (error: any) {
            toast({
                title: "GitHub 로그인 실패",
                description: error.message,
                variant: "destructive",
            });
            throw error;
        } finally {
            setLoading(false);
        }
    };

    const signOut = async (): Promise<void> => {
        try {
            await authSignOut();
            trackEvents.signOut();
            toast({
                title: "로그아웃",
                description: "성공적으로 로그아웃되었습니다.",
            });
        } catch (error: any) {
            toast({
                title: "로그아웃 실패",
                description: error.message,
                variant: "destructive",
            });
            throw error;
        }
    };

    const resetPassword = async (email: string): Promise<void> => {
        try {
            await authResetPassword(email);
            toast({
                title: "비밀번호 재설정",
                description: "비밀번호 재설정 이메일이 발송되었습니다.",
            });
        } catch (error: any) {
            toast({
                title: "비밀번호 재설정 실패",
                description: error.message,
                variant: "destructive",
            });
            throw error;
        }
    };

    const updateProfile = async (updates: Partial<UserProfile>): Promise<void> => {
        if (!user) throw new Error('User not authenticated');

        try {
            await updateUserProfile(user.uid, updates);
            setUserProfile(prev => prev ? { ...prev, ...updates } : null);
            trackEvents.updateProfile();
            toast({
                title: "프로필 업데이트",
                description: "프로필이 성공적으로 업데이트되었습니다.",
            });
        } catch (error: any) {
            toast({
                title: "프로필 업데이트 실패",
                description: error.message,
                variant: "destructive",
            });
            throw error;
        }
    };

    const changePassword = async (currentPassword: string, newPassword: string): Promise<void> => {
        try {
            await authChangePassword(currentPassword, newPassword);
            trackEvents.changePassword();
            toast({
                title: "비밀번호 변경 완료",
                description: "비밀번호가 성공적으로 변경되었습니다.",
            });
        } catch (error: any) {
            toast({
                title: "비밀번호 변경 실패",
                description: error.message,
                variant: "destructive",
            });
            throw error;
        }
    };

    const value: AuthContextType = {
        user,
        userProfile,
        loading,
        signIn,
        signUp,
        signInWithGoogle,
        signInWithGitHub,
        signOut,
        resetPassword,
        updateProfile,
        changePassword,
    };

    return (
        <AuthContext.Provider value={value}>
            {children}
        </AuthContext.Provider>
    );
};

export const useAuth = (): AuthContextType => {
    const context = useContext(AuthContext);
    if (context === undefined) {
        throw new Error('useAuth must be used within an AuthProvider');
    }
    return context;
}; 