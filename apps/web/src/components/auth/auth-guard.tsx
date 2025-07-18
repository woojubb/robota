'use client';

import { useEffect, useRef } from 'react';
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
    const hasRedirected = useRef(false);

    useEffect(() => {
        // Reset redirect flag when pathname changes
        hasRedirected.current = false;
    }, [pathname]);

    useEffect(() => {
        // Don't do anything while auth is loading or if we've already redirected
        if (loading || hasRedirected.current) {
            return;
        }

        // Handle redirects after auth check is complete
        if (requireAuth && !user) {
            // User needs to be authenticated but isn't
            hasRedirected.current = true;
            const loginUrl = `/auth/login?redirect=${encodeURIComponent(pathname)}`;
            router.replace(redirectTo || loginUrl);
        } else if (!requireAuth && user) {
            // User shouldn't be authenticated but is (e.g., on login/register page)
            hasRedirected.current = true;
            router.replace(redirectTo || '/dashboard');
        }
    }, [user, loading, requireAuth, redirectTo, pathname, router]);

    // Show loading state while auth is being checked
    if (loading) {
        return <>{fallback}</>;
    }

    // If we need auth and don't have it, show fallback while redirecting
    if (requireAuth && !user) {
        return <>{fallback}</>;
    }

    // If we shouldn't have auth but do, show fallback while redirecting
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