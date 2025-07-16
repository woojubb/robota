'use client';

import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/contexts/auth-context';
import { PublicOnlyRoute } from '@/components/auth/auth-guard';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { Icons } from '@/components/ui/icons';
import { AlertCircle, Github } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';

function LoginPageContent() {
    const { signIn, signInWithGoogle, signInWithGitHub, loading } = useAuth();
    const router = useRouter();
    const searchParams = useSearchParams();
    const [formData, setFormData] = useState({
        email: '',
        password: '',
    });
    const [errors, setErrors] = useState<string>('');
    const [isSubmitting, setIsSubmitting] = useState(false);

    const redirectTo = searchParams.get('redirect') || '/dashboard';

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
            router.push(redirectTo);
        } catch (error: any) {
            setErrors(error.message);
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleGoogleSignIn = async () => {
        try {
            await signInWithGoogle();
            router.push(redirectTo);
        } catch (error: any) {
            setErrors(error.message);
        }
    };

    const handleGitHubSignIn = async () => {
        try {
            await signInWithGitHub();
            router.push(redirectTo);
        } catch (error: any) {
            setErrors(error.message);
        }
    };

    return (
        <div className="min-h-screen flex items-center justify-center bg-background px-4 py-12">
            <div className="w-full max-w-md space-y-8">
                {/* Header */}
                <div className="text-center">
                    <h1 className="text-3xl font-bold tracking-tight">로그인</h1>
                    <p className="text-muted-foreground mt-2">
                        계정에 로그인하여 Robota를 시작하세요
                    </p>
                </div>

                <Card className="border-border/50">
                    <CardHeader className="space-y-1">
                        <CardTitle className="text-2xl text-center">환영합니다</CardTitle>
                        <CardDescription className="text-center">
                            이메일과 비밀번호로 로그인하거나 소셜 계정을 사용하세요
                        </CardDescription>
                    </CardHeader>

                    <CardContent className="space-y-4">
                        {/* Social Login Buttons */}
                        <div className="grid grid-cols-2 gap-4">
                            <Button
                                variant="outline"
                                onClick={handleGoogleSignIn}
                                disabled={loading || isSubmitting}
                                className="w-full"
                            >
                                <Icons.google className="mr-2 h-4 w-4" />
                                Google
                            </Button>
                            <Button
                                variant="outline"
                                onClick={handleGitHubSignIn}
                                disabled={loading || isSubmitting}
                                className="w-full"
                            >
                                <Github className="mr-2 h-4 w-4" />
                                GitHub
                            </Button>
                        </div>

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
                                disabled={isSubmitting || loading}
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