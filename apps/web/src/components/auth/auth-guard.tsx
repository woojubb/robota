'use client';

import { useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useAuth } from '@/contexts/auth-context';
import { Icons } from '@/components/ui/icons';

interface AuthGuardProps {
    children: React.ReactNode;
    requireAuth?: boolean;
    redirectTo?: string;
    fallback?: React.ReactNode;
}

const LoadingSpinner = () => (
    <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center space-y-4">
            <Icons.spinner className="h-8 w-8 animate-spin mx-auto text-primary" />
            <p className="text-muted-foreground">로딩 중...</p>
        </div>
    </div>
);

export const AuthGuard: React.FC<AuthGuardProps> = ({
    children,
    requireAuth = true,
    redirectTo,
    fallback = <LoadingSpinner />,
}) => {
    const { user, loading } = useAuth();
    const router = useRouter();
    const pathname = usePathname();
    const [isInitialized, setIsInitialized] = useState(false);
    const [isRedirecting, setIsRedirecting] = useState(false);

    useEffect(() => {
        if (loading) {
            return;
        }

        setIsInitialized(true);

        if (requireAuth && !user && !isRedirecting) {
            // User needs to be authenticated but isn't
            setIsRedirecting(true);
            const loginUrl = `/auth/login?redirect=${encodeURIComponent(pathname)}`;
            router.replace(redirectTo || loginUrl);
        } else if (!requireAuth && user && !isRedirecting) {
            // User shouldn't be authenticated but is (e.g., on login page)
            setIsRedirecting(true);
            router.replace(redirectTo || '/dashboard');
        }
    }, [user, loading, requireAuth, redirectTo, pathname, router, isRedirecting]);

    // Show loading state while auth is being checked
    if (loading || !isInitialized) {
        return <>{fallback}</>;
    }

    // Show loading while redirecting
    if (isRedirecting) {
        return <>{fallback}</>;
    }

    // Check auth requirements
    if (requireAuth && !user) {
        return <>{fallback}</>;
    }

    if (!requireAuth && user) {
        return <>{fallback}</>;
    }

    // Everything is fine, render the children
    return <>{children}</>;
};

// Specific guards for common use cases
export const ProtectedRoute: React.FC<{ children: React.ReactNode }> = ({
    children,
}) => (
    <AuthGuard requireAuth={true}>
        {children}
    </AuthGuard>
);

export const PublicOnlyRoute: React.FC<{ children: React.ReactNode }> = ({
    children,
}) => (
    <AuthGuard requireAuth={false}>
        {children}
    </AuthGuard>
);

// Hook for checking auth status
export const useAuthGuard = () => {
    const { user, loading } = useAuth();

    return {
        isAuthenticated: !!user,
        isLoading: loading,
        user,
    };
}; 