'use client';

import { useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/contexts/auth-context';
import { PublicOnlyRoute } from '@/components/auth/auth-guard';
import { SocialLoginButtons } from '@/components/auth/social-login-buttons';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Icons } from '@/components/ui/icons';
import { AlertCircle } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';

function LoginPageContent() {
    const { signIn, user, loading } = useAuth();
    const router = useRouter();
    const searchParams = useSearchParams();
    const [formData, setFormData] = useState({
        email: '',
        password: '',
    });
    const [errors, setErrors] = useState<string>('');
    const [isSubmitting, setIsSubmitting] = useState(false);

    const redirectTo = searchParams.get('redirect') || '/dashboard';

    // Redirect authenticated users
    useEffect(() => {
        if (!loading && user) {
            console.log('User authenticated, redirecting to:', redirectTo);
            router.replace(redirectTo);
        }
    }, [user, loading, redirectTo, router]);

    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const { name, value } = e.target;
        setFormData(prev => ({ ...prev, [name]: value }));
        if (errors) setErrors('');
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setErrors('');
        setIsSubmitting(true);

        try {
            await signIn(formData.email, formData.password);
            // Don't redirect here - let the useEffect handle it after auth state updates
        } catch (error: any) {
            setErrors(error.message);
            setIsSubmitting(false);
        }
    };

    const handleSocialLoginError = (error: string) => {
        setErrors(error);
    };

    return (
        <div className="min-h-screen flex items-center justify-center bg-background px-4 py-12">
            <div className="w-full max-w-md space-y-8">
                {/* Header */}
                <div className="text-center">
                    <h1 className="text-3xl font-bold tracking-tight">로그인</h1>
                    <p className="text-muted-foreground mt-2">
                        계정에 로그인하여 Robota를 사용하세요
                    </p>
                </div>

                <Card className="border-border/50">
                    <CardHeader className="space-y-1">
                        <CardTitle className="text-2xl text-center">환영합니다</CardTitle>
                        <CardDescription className="text-center">
                            이메일과 비밀번호로 로그인하세요
                        </CardDescription>
                    </CardHeader>

                    <CardContent className="space-y-4">
                        {/* Social Login Buttons */}
                        <SocialLoginButtons
                            onError={handleSocialLoginError}
                            redirectTo={redirectTo}
                            disabled={isSubmitting}
                        />

                        {/* Error Alert */}
                        {errors && (
                            <Alert variant="destructive">
                                <AlertCircle className="h-4 w-4" />
                                <AlertDescription>{errors}</AlertDescription>
                            </Alert>
                        )}

                        {/* Login Form */}
                        <form onSubmit={handleSubmit} className="space-y-4">
                            <div className="space-y-2">
                                <Label htmlFor="email">이메일</Label>
                                <Input
                                    id="email"
                                    name="email"
                                    type="email"
                                    placeholder="name@example.com"
                                    value={formData.email}
                                    onChange={handleInputChange}
                                    required
                                    disabled={isSubmitting}
                                />
                            </div>

                            <div className="space-y-2">
                                <Label htmlFor="password">비밀번호</Label>
                                <Input
                                    id="password"
                                    name="password"
                                    type="password"
                                    placeholder="비밀번호를 입력하세요"
                                    value={formData.password}
                                    onChange={handleInputChange}
                                    required
                                    disabled={isSubmitting}
                                />
                            </div>

                            <div className="flex items-center justify-between">
                                <Link
                                    href="/auth/reset-password"
                                    className="text-sm text-primary hover:underline"
                                >
                                    비밀번호를 잊으셨나요?
                                </Link>
                            </div>

                            <Button
                                type="submit"
                                className="w-full"
                                disabled={isSubmitting}
                            >
                                {isSubmitting ? (
                                    <>
                                        <Icons.spinner className="mr-2 h-4 w-4 animate-spin" />
                                        로그인 중...
                                    </>
                                ) : (
                                    '로그인'
                                )}
                            </Button>
                        </form>

                        {/* Sign up link */}
                        <div className="text-center text-sm">
                            계정이 없으신가요?{' '}
                            <Link href="/auth/register" className="text-primary hover:underline">
                                회원가입
                            </Link>
                        </div>
                    </CardContent>
                </Card>

                {/* Back to home */}
                <div className="text-center">
                    <Link
                        href="/"
                        className="text-sm text-muted-foreground hover:text-primary transition-colors"
                    >
                        ← 홈으로 돌아가기
                    </Link>
                </div>
            </div>
        </div>
    );
}

export default function LoginPage() {
    return (
        <PublicOnlyRoute>
            <LoginPageContent />
        </PublicOnlyRoute>
    );
} 