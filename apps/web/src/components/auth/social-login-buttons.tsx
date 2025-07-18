'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/auth-context';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Icons } from '@/components/ui/icons';
import { Github } from 'lucide-react';
import { isProviderEnabled, isSocialLoginEnabled } from '@/lib/auth/auth-config';

interface SocialLoginButtonsProps {
    onError?: (error: string) => void;
    redirectTo?: string;
    disabled?: boolean;
}

export function SocialLoginButtons({
    onError,
    redirectTo = '/dashboard',
    disabled = false
}: SocialLoginButtonsProps) {
    const { signInWithGoogle, signInWithGitHub, loading } = useAuth();
    const router = useRouter();
    const [isLoading, setIsLoading] = useState(false);

    // Check if social login is enabled
    const socialLoginEnabled = isSocialLoginEnabled();
    const googleEnabled = isProviderEnabled('google');
    const githubEnabled = isProviderEnabled('github');

    if (!socialLoginEnabled) {
        return null;
    }

    const handleGoogleSignIn = async () => {
        if (!googleEnabled) return;

        setIsLoading(true);
        try {
            await signInWithGoogle();
            router.push(redirectTo);
        } catch (error: any) {
            onError?.(error.message);
        } finally {
            setIsLoading(false);
        }
    };

    const handleGitHubSignIn = async () => {
        if (!githubEnabled) return;

        setIsLoading(true);
        try {
            await signInWithGitHub();
            router.push(redirectTo);
        } catch (error: any) {
            onError?.(error.message);
        } finally {
            setIsLoading(false);
        }
    };

    const isButtonDisabled = disabled || loading || isLoading;

    return (
        <>
            {/* Social Login Buttons */}
            <div className="grid grid-cols-1 gap-3">
                {googleEnabled && (
                    <Button
                        variant="outline"
                        onClick={handleGoogleSignIn}
                        disabled={isButtonDisabled}
                        className="w-full"
                    >
                        <Icons.google className="mr-2 h-4 w-4" />
                        Google로 계속하기
                    </Button>
                )}

                {githubEnabled && (
                    <Button
                        variant="outline"
                        onClick={handleGitHubSignIn}
                        disabled={isButtonDisabled}
                        className="w-full"
                    >
                        <Github className="mr-2 h-4 w-4" />
                        GitHub로 계속하기
                    </Button>
                )}
            </div>

            {/* Separator */}
            <div className="relative">
                <div className="absolute inset-0 flex items-center">
                    <Separator className="w-full" />
                </div>
                <div className="relative flex justify-center text-xs uppercase">
                    <span className="bg-background px-2 text-muted-foreground">
                        또는 이메일로 계속
                    </span>
                </div>
            </div>
        </>
    );
} 