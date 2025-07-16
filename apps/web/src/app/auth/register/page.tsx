'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/contexts/auth-context';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { Icons } from '@/components/ui/icons';
import { AlertCircle, Github } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';

export default function RegisterPage() {
    const { signUp, signInWithGoogle, signInWithGitHub, loading } = useAuth();
    const router = useRouter();
    const [formData, setFormData] = useState({
        displayName: '',
        email: '',
        password: '',
        confirmPassword: '',
    });
    const [errors, setErrors] = useState<string>('');
    const [isSubmitting, setIsSubmitting] = useState(false);

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
            router.push('/dashboard');
        } catch (error: any) {
            setErrors(error.message);
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleGoogleSignIn = async () => {
        try {
            await signInWithGoogle();
            router.push('/dashboard');
        } catch (error: any) {
            setErrors(error.message);
        }
    };

    const handleGitHubSignIn = async () => {
        try {
            await signInWithGitHub();
            router.push('/dashboard');
        } catch (error: any) {
            setErrors(error.message);
        }
    };

    return (
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
                            이메일과 비밀번호로 계정을 생성하거나 소셜 계정을 사용하세요
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
                                disabled={isSubmitting || loading}
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

                        {/* Terms and conditions */}
                        <p className="text-xs text-muted-foreground text-center">
                            계정을 생성하면{' '}
                            <Link href="/terms" className="text-primary hover:underline">
                                서비스 약관
                            </Link>
                            과{' '}
                            <Link href="/privacy" className="text-primary hover:underline">
                                개인정보 처리방침
                            </Link>
                            에 동의하는 것으로 간주됩니다.
                        </p>

                        {/* Sign in link */}
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
    );
} 