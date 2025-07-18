'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
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

export default function RegisterPage() {
    const { signUp, user, loading } = useAuth();
    const router = useRouter();
    const [formData, setFormData] = useState({
        displayName: '',
        email: '',
        password: '',
        confirmPassword: '',
    });
    const [errors, setErrors] = useState<string>('');
    const [isSubmitting, setIsSubmitting] = useState(false);

    // Redirect authenticated users
    useEffect(() => {
        if (!loading && user) {
            console.log('User registered and authenticated, redirecting to dashboard');
            router.replace('/dashboard');
        }
    }, [user, loading, router]);

    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const { name, value } = e.target;
        setFormData(prev => ({ ...prev, [name]: value }));
        if (errors) setErrors('');
    };

    const validateForm = () => {
        if (formData.password !== formData.confirmPassword) {
            setErrors('비밀번호가 일치하지 않습니다.');
            return false;
        }
        if (formData.password.length < 6) {
            setErrors('비밀번호는 6자 이상이어야 합니다.');
            return false;
        }
        return true;
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setErrors('');

        if (!validateForm()) return;

        setIsSubmitting(true);

        try {
            await signUp(formData.email, formData.password, formData.displayName);
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
        <PublicOnlyRoute>
            <div className="min-h-screen flex items-center justify-center bg-background px-4 py-12">
                <div className="w-full max-w-md space-y-8">
                    {/* Header */}
                    <div className="text-center">
                        <h1 className="text-3xl font-bold tracking-tight">회원가입</h1>
                        <p className="text-muted-foreground mt-2">
                            계정을 생성하여 Robota를 시작하세요
                        </p>
                    </div>

                    <Card className="border-border/50">
                        <CardHeader className="space-y-1">
                            <CardTitle className="text-2xl text-center">계정 생성</CardTitle>
                            <CardDescription className="text-center">
                                이메일과 비밀번호로 계정을 생성하세요
                            </CardDescription>
                        </CardHeader>

                        <CardContent className="space-y-4">
                            {/* Social Login Buttons */}
                            <SocialLoginButtons
                                onError={handleSocialLoginError}
                                redirectTo="/dashboard"
                                disabled={isSubmitting}
                            />

                            {/* Error Alert */}
                            {errors && (
                                <Alert variant="destructive">
                                    <AlertCircle className="h-4 w-4" />
                                    <AlertDescription>{errors}</AlertDescription>
                                </Alert>
                            )}

                            {/* Register Form */}
                            <form onSubmit={handleSubmit} className="space-y-4">
                                <div className="space-y-2">
                                    <Label htmlFor="displayName">이름</Label>
                                    <Input
                                        id="displayName"
                                        name="displayName"
                                        type="text"
                                        placeholder="홍길동"
                                        value={formData.displayName}
                                        onChange={handleInputChange}
                                        required
                                        disabled={isSubmitting}
                                    />
                                </div>

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
                                        placeholder="6자 이상의 비밀번호"
                                        value={formData.password}
                                        onChange={handleInputChange}
                                        required
                                        disabled={isSubmitting}
                                    />
                                </div>

                                <div className="space-y-2">
                                    <Label htmlFor="confirmPassword">비밀번호 확인</Label>
                                    <Input
                                        id="confirmPassword"
                                        name="confirmPassword"
                                        type="password"
                                        placeholder="비밀번호를 다시 입력하세요"
                                        value={formData.confirmPassword}
                                        onChange={handleInputChange}
                                        required
                                        disabled={isSubmitting}
                                    />
                                </div>

                                <Button
                                    type="submit"
                                    className="w-full"
                                    disabled={isSubmitting}
                                >
                                    {isSubmitting ? (
                                        <>
                                            <Icons.spinner className="mr-2 h-4 w-4 animate-spin" />
                                            계정 생성 중...
                                        </>
                                    ) : (
                                        '계정 생성'
                                    )}
                                </Button>
                            </form>

                            {/* Login link */}
                            <div className="text-center text-sm">
                                이미 계정이 있으신가요?{' '}
                                <Link href="/auth/login" className="text-primary hover:underline">
                                    로그인
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
        </PublicOnlyRoute>
    );
} 