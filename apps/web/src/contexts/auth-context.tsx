'use client';

import React, { createContext, useContext, useEffect, useState, useRef } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { useRouter, usePathname } from 'next/navigation';
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
import { apiClient, setAuthRedirectCallback, setToastCallback } from '@/lib/api-client';
import { debugStorageInfo, isLocalStorageAvailable } from '@/lib/storage-check';

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
    const [authInitialized, setAuthInitialized] = useState(false);
    const { toast } = useToast();
    const router = useRouter();
    const pathname = usePathname();

    // Track if we've already loaded data for the current user
    const loadedUserRef = useRef<string | null>(null);

    // Debug storage on mount
    useEffect(() => {
        debugStorageInfo();

        // Check if localStorage is available
        if (!isLocalStorageAvailable()) {
            toast({
                title: "Storage Warning",
                description: "Browser storage is not available. You may be logged out on page refresh.",
                variant: "destructive",
            });
        }
    }, [toast]);

    // Setup auth redirect callback and toast callback
    useEffect(() => {
        const handleAuthRedirect = () => {
            // Don't redirect if already on auth pages or if auth is not initialized
            if (pathname?.startsWith('/auth/') || !authInitialized) {
                return;
            }

            // Show toast notification
            toast({
                title: "Authentication Required",
                description: "Your session has expired. Please log in again.",
                variant: "destructive",
            });

            // Sign out user
            setUser(null);
            setUserProfile(null);
            setUserExtended(null);
            setCreditSummary(null);
            loadedUserRef.current = null;

            // Redirect to login with current path as redirect parameter
            const currentPath = pathname || '/dashboard';
            const redirectUrl = currentPath !== '/auth/login' && currentPath !== '/'
                ? `?redirect=${encodeURIComponent(currentPath)}`
                : '';

            router.push(`/auth/login${redirectUrl}`);
        };

        const handleToast = (message: { title: string; description: string; variant?: 'default' | 'destructive' }) => {
            toast(message);
        };

        setAuthRedirectCallback(handleAuthRedirect);
        setToastCallback(handleToast);

        // Cleanup
        return () => {
            setAuthRedirectCallback(null);
            setToastCallback(null);
        };
    }, [pathname, router, toast, authInitialized]);

    // Listen to auth state changes
    useEffect(() => {
        console.log('Setting up auth state listener');

        const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
            console.log('Auth state changed:', {
                user: firebaseUser ? {
                    uid: firebaseUser.uid,
                    email: firebaseUser.email,
                    displayName: firebaseUser.displayName
                } : null,
                authInitialized,
                loading
            });

            if (firebaseUser) {
                const user = convertFirebaseUser(firebaseUser);
                setUser(user);

                // Only load user data if we haven't already loaded it for this user AND auth is initialized
                if (loadedUserRef.current !== firebaseUser.uid && authInitialized) {
                    console.log('Loading user data for new user:', firebaseUser.uid);
                    loadedUserRef.current = firebaseUser.uid;

                    try {
                        // Wait a bit to ensure token is ready
                        await new Promise(resolve => setTimeout(resolve, 100));

                        // Get fresh token for API call
                        const token = await firebaseUser.getIdToken(false);
                        console.log('Got token for API call:', {
                            tokenLength: token.length,
                            uid: firebaseUser.uid
                        });

                        // Load user profile only once per session
                        console.log('Calling profile API...');
                        const profileResponse = await apiClient.user.getProfile();
                        console.log('Profile API response:', {
                            success: profileResponse.success,
                            hasData: !!profileResponse.data,
                            error: profileResponse.error
                        });

                        if (profileResponse.success && profileResponse.data) {
                            // Convert string dates to Date objects
                            const profileData = { ...profileResponse.data };
                            if (profileData.createdAt && typeof profileData.createdAt === 'string') {
                                profileData.createdAt = new Date(profileData.createdAt);
                            }
                            if (profileData.updatedAt && typeof profileData.updatedAt === 'string') {
                                profileData.updatedAt = new Date(profileData.updatedAt);
                            }

                            setUserProfile(profileData);
                            setUserExtended(profileData as any);
                            console.log('User profile loaded successfully');
                        } else {
                            console.error('Profile API failed:', profileResponse.error);
                        }

                        // Don't load credit summary on initial load - let components request it when needed
                        // This reduces unnecessary API calls
                    } catch (error) {
                        console.error('Error loading user data:', error);
                        // Don't show error toast on initial load failures
                    }
                } else if (firebaseUser.uid === loadedUserRef.current) {
                    console.log('User data already loaded for:', firebaseUser.uid);
                }
            } else {
                console.log('User signed out, clearing auth state');
                setUser(null);
                setUserProfile(null);
                setUserExtended(null);
                setCreditSummary(null);
                loadedUserRef.current = null;
            }

            // Mark auth as initialized after first state change
            if (!authInitialized) {
                setAuthInitialized(true);
            }
            setLoading(false);
        });

        return () => {
            console.log('Cleaning up auth state listener');
            unsubscribe();
        };
    }, [authInitialized]);

    // Check localStorage for debugging (only after auth is initialized)
    useEffect(() => {
        if (typeof window !== 'undefined' && authInitialized) {
            const checkStorage = () => {
                const firebaseKeys = Object.keys(localStorage).filter(key =>
                    key.includes('firebase') || key.includes('auth')
                );
                console.log('Firebase/Auth localStorage keys:', firebaseKeys);

                // Check for specific Firebase auth keys
                const authKeys = [
                    `firebase:authUser:${process.env.NEXT_PUBLIC_FIREBASE_API_KEY}:[DEFAULT]`,
                    'firebase:host:auth.firebase.com'
                ];

                authKeys.forEach(key => {
                    const value = localStorage.getItem(key);
                    if (value) {
                        console.log(`Found auth data in localStorage for ${key}:`, !!value);
                    }
                });
            };

            checkStorage();

            // Check storage less frequently and only when needed
            const interval = setInterval(checkStorage, 10000); // Every 10 seconds instead of 5
            return () => clearInterval(interval);
        }
    }, [authInitialized]);

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
                // Convert string dates to Date objects
                const profileData = { ...profileResponse.data };
                if (profileData.createdAt && typeof profileData.createdAt === 'string') {
                    profileData.createdAt = new Date(profileData.createdAt);
                }
                if (profileData.updatedAt && typeof profileData.updatedAt === 'string') {
                    profileData.updatedAt = new Date(profileData.updatedAt);
                }

                setUserProfile(profileData);
                setUserExtended(profileData as any);
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
        authInitialized,
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