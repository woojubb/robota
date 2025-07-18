'use client';

import React, { createContext, useContext, useEffect, useState, useRef } from 'react';
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
} from '@/lib/firebase/auth-service';
import { User, UserProfile, AuthContextType } from '@/types/auth';
import { UserExtended, UserCreditSummary } from '@/types/user-credit';
import { useToast } from '@/hooks/use-toast';
import { trackEvents } from '@/lib/analytics/google-analytics';
import { apiClient } from '@/lib/api-client';

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export interface AuthProviderProps {
    children: React.ReactNode;
}

export const AuthProvider: React.FC<AuthProviderProps> = ({ children }) => {
    const [user, setUser] = useState<User | null>(null);
    const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
    const [userExtended, setUserExtended] = useState<UserExtended | null>(null);
    const [creditSummary, setCreditSummary] = useState<UserCreditSummary | null>(null);
    const [loading, setLoading] = useState(true);
    const { toast } = useToast();

    // Track if we've already loaded data for the current user
    const loadedUserRef = useRef<string | null>(null);

    // Listen to auth state changes
    useEffect(() => {
        const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
            if (firebaseUser) {
                const user = convertFirebaseUser(firebaseUser);
                setUser(user);

                // Only load user data if we haven't already loaded it for this user
                if (loadedUserRef.current !== firebaseUser.uid) {
                    loadedUserRef.current = firebaseUser.uid;

                    try {
                        // Load user profile only once per session
                        const profileResponse = await apiClient.user.getProfile();
                        if (profileResponse.success && profileResponse.data) {
                            setUserProfile(profileResponse.data);
                            setUserExtended(profileResponse.data as any);
                        }

                        // Don't load credit summary on initial load - let components request it when needed
                        // This reduces unnecessary API calls
                    } catch (error) {
                        console.error('Error loading user data:', error);
                        // Don't show error toast on initial load failures
                    }
                }
            } else {
                setUser(null);
                setUserProfile(null);
                setUserExtended(null);
                setCreditSummary(null);
                loadedUserRef.current = null;
            }
            setLoading(false);
        });

        return () => unsubscribe();
    }, []);

    // Load credit summary on demand
    const loadCreditSummary = async () => {
        if (!user) return;

        try {
            const creditsResponse = await apiClient.user.getCredits();
            if (creditsResponse.success && creditsResponse.data) {
                setCreditSummary(creditsResponse.data);
            }
        } catch (error) {
            console.error('Error loading credit summary:', error);
        }
    };

    // Load credit summary when userExtended is set
    useEffect(() => {
        if (userExtended && !creditSummary) {
            loadCreditSummary();
        }
    }, [userExtended]);

    // Authentication methods
    const signIn = async (email: string, password: string): Promise<void> => {
        try {
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
        }
    };

    const signUp = async (email: string, password: string, displayName: string): Promise<void> => {
        try {
            await authSignUp(email, password, displayName);

            // Wait a bit for auth state to update
            await new Promise(resolve => setTimeout(resolve, 1000));

            // Create user profile via API
            try {
                await fetch('/api/v1/user/profile', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${await auth.currentUser?.getIdToken()}`,
                    },
                    body: JSON.stringify({ email, displayName }),
                });
            } catch (profileError) {
                console.error('Error creating user profile:', profileError);
                // Don't throw here, as the user is already created
            }

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
        }
    };

    const signInWithGoogle = async (): Promise<void> => {
        try {
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
        }
    };

    const signInWithGitHub = async (): Promise<void> => {
        try {
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
        }
    };

    const signOut = async (): Promise<void> => {
        try {
            await authSignOut();
            trackEvents.signOut();
            toast({
                title: "로그아웃 완료",
                description: "안녕히 가세요!",
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
                title: "비밀번호 재설정 이메일 전송",
                description: "이메일을 확인해주세요.",
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

    const changePassword = async (currentPassword: string, newPassword: string): Promise<void> => {
        try {
            await authChangePassword(currentPassword, newPassword);
            trackEvents.changePassword();
            toast({
                title: "비밀번호 변경 성공",
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

    const updateProfile = async (data: Partial<UserProfile>): Promise<void> => {
        if (!user) throw new Error('User not authenticated');

        try {
            const response = await apiClient.user.updateProfile(data);
            if (response.success && response.data) {
                setUserProfile(response.data);
                trackEvents.updateProfile();
                toast({
                    title: "프로필 업데이트 성공",
                    description: "프로필이 성공적으로 업데이트되었습니다.",
                });
            } else {
                throw new Error(response.error || 'Update failed');
            }
        } catch (error: any) {
            toast({
                title: "프로필 업데이트 실패",
                description: error.message,
                variant: "destructive",
            });
            throw error;
        }
    };

    const refreshProfile = async (): Promise<void> => {
        if (!user) throw new Error('User not authenticated');

        try {
            const profileResponse = await apiClient.user.getProfile();
            if (profileResponse.success && profileResponse.data) {
                setUserProfile(profileResponse.data);
                setUserExtended(profileResponse.data as any);
            }

            const creditsResponse = await apiClient.user.getCredits();
            if (creditsResponse.success && creditsResponse.data) {
                setCreditSummary(creditsResponse.data);
            }
        } catch (error: any) {
            toast({
                title: "프로필 새로고침 실패",
                description: error.message,
                variant: "destructive",
            });
            throw error;
        }
    };

    const value: AuthContextType = {
        user,
        userProfile,
        userExtended,
        creditSummary,
        loading,
        signIn,
        signUp,
        signInWithGoogle,
        signInWithGitHub,
        signOut,
        resetPassword,
        changePassword,
        updateProfile,
        refreshProfile,
    };

    return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = (): AuthContextType => {
    const context = useContext(AuthContext);
    if (context === undefined) {
        throw new Error('useAuth must be used within an AuthProvider');
    }
    return context;
}; 