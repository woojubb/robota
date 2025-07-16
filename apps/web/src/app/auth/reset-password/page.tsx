'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/contexts/auth-context';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Icons } from '@/components/ui/icons';
import { AlertCircle, CheckCircle, Mail } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';

export default function ResetPasswordPage() {
    const { resetPassword, loading } = useAuth();
    const [email, setEmail] = useState('');
    const [errors, setErrors] = useState<string>('');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [isSuccess, setIsSuccess] = useState(false);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setErrors('');
        setIsSubmitting(true);

        try {
            await resetPassword(email);
            setIsSuccess(true);
        } catch (error: any) {
            setErrors(error.message);
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <div className="min-h-screen flex items-center justify-center bg-background px-4 py-12">
            <div className="w-full max-w-md space-y-8">
                {/* Header */}
                <div className="text-center">
                    <h1 className="text-3xl font-bold tracking-tight">비밀번호 재설정</h1>
                    <p className="text-muted-foreground mt-2">
                        등록한 이메일로 비밀번호 재설정 링크를 보내드립니다
                    </p>
                </div>

                <Card className="border-border/50">
                    <CardHeader className="space-y-1">
                        <CardTitle className="text-2xl text-center flex items-center justify-center gap-2">
                            <Mail className="h-6 w-6" />
                            이메일 확인
                        </CardTitle>
                        <CardDescription className="text-center">
                            {isSuccess
                                ? '재설정 링크가 발송되었습니다'
                                : '비밀번호 재설정을 위해 이메일을 입력해주세요'
                            }
                        </CardDescription>
                    </CardHeader>

                    <CardContent className="space-y-4">
                        {isSuccess ? (
                            <div className="space-y-4">
                                <Alert>
                                    <CheckCircle className="h-4 w-4" />
                                    <AlertDescription>
                                        <strong>{email}</strong>으로 비밀번호 재설정 링크를 발송했습니다.
                                        이메일을 확인하고 링크를 클릭하여 새 비밀번호를 설정하세요.
                                    </AlertDescription>
                                </Alert>

                                <div className="text-center text-sm text-muted-foreground">
                                    이메일이 도착하지 않았나요?
                                    <Button
                                        variant="link"
                                        className="p-0 h-auto ml-1"
                                        onClick={() => {
                                            setIsSuccess(false);
                                            setEmail('');
                                        }}
                                    >
                                        다시 시도
                                    </Button>
                                </div>
                            </div>
                        ) : (
                            <>
                                {/* Error Alert */}
                                {errors && (
                                    <Alert variant="destructive">
                                        <AlertCircle className="h-4 w-4" />
                                        <AlertDescription>{errors}</AlertDescription>
                                    </Alert>
                                )}

                                {/* Reset Form */}
                                <form onSubmit={handleSubmit} className="space-y-4">
                                    <div className="space-y-2">
                                        <Label htmlFor="email">이메일</Label>
                                        <Input
                                            id="email"
                                            name="email"
                                            type="email"
                                            placeholder="name@example.com"
                                            value={email}
                                            onChange={(e) => {
                                                setEmail(e.target.value);
                                                if (errors) setErrors('');
                                            }}
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
                                                발송 중...
                                            </>
                                        ) : (
                                            '재설정 링크 발송'
                                        )}
                                    </Button>
                                </form>
                            </>
                        )}

                        {/* Navigation links */}
                        <div className="text-center text-sm space-y-2">
                            <div>
                                <Link href="/auth/login" className="text-primary hover:underline">
                                    ← 로그인으로 돌아가기
                                </Link>
                            </div>
                            <div>
                                계정이 없으신가요?{' '}
                                <Link href="/auth/register" className="text-primary hover:underline">
                                    회원가입
                                </Link>
                            </div>
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