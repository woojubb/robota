'use client';

import { useAuth } from '@/contexts/auth-context';
import { ProtectedRoute } from '@/components/auth/auth-guard';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import {
    User,
    Settings,
    Code2,
    BarChart3,
    FileText,
    LogOut,
    Crown,
    Calendar,
    Activity
} from 'lucide-react';
import Link from 'next/link';

function DashboardContent() {
    const { user, userProfile, signOut } = useAuth();

    const handleSignOut = async () => {
        try {
            await signOut();
        } catch (error) {
            console.error('Sign out error:', error);
        }
    };

    const getUserDisplayName = () => {
        return userProfile?.displayName || user?.displayName || 'Anonymous';
    };

    const getInitials = (name: string | null) => {
        if (!name) return 'U';
        return name
            .split(' ')
            .map(word => word[0])
            .join('')
            .toUpperCase()
            .slice(0, 2);
    };

    const formatDate = (date: Date | undefined) => {
        if (!date) return '정보 없음';
        return new Intl.DateTimeFormat('ko-KR', {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
        }).format(date);
    };

    return (
        <div className="min-h-screen bg-background">
            {/* Header */}
            <header className="border-b">
                <div className="container mx-auto px-4 py-4">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center space-x-4">
                            <Link href="/" className="text-2xl font-bold">
                                Robota
                            </Link>
                            <Separator orientation="vertical" className="h-6" />
                            <nav className="flex items-center space-x-6">
                                <Link
                                    href="/dashboard"
                                    className="text-sm font-medium text-primary"
                                >
                                    대시보드
                                </Link>
                                <Link
                                    href="/playground"
                                    className="text-sm font-medium text-muted-foreground hover:text-primary"
                                >
                                    Playground
                                </Link>
                                <Link
                                    href="/projects"
                                    className="text-sm font-medium text-muted-foreground hover:text-primary"
                                >
                                    프로젝트
                                </Link>
                            </nav>
                        </div>

                        <div className="flex items-center space-x-4">
                            <Avatar>
                                <AvatarImage src={user?.photoURL || ''} />
                                <AvatarFallback>
                                    {getInitials(getUserDisplayName())}
                                </AvatarFallback>
                            </Avatar>

                            <div className="hidden md:block">
                                <p className="text-sm font-medium">{getUserDisplayName()}</p>
                                <p className="text-xs text-muted-foreground">{user?.email}</p>
                            </div>

                            <Button
                                variant="ghost"
                                size="icon"
                                onClick={handleSignOut}
                                title="로그아웃"
                            >
                                <LogOut className="h-4 w-4" />
                            </Button>
                        </div>
                    </div>
                </div>
            </header>

            {/* Main Content */}
            <main className="container mx-auto px-4 py-8">
                <div className="space-y-8">
                    {/* Welcome Section */}
                    <div className="space-y-2">
                        <h1 className="text-3xl font-bold tracking-tight">
                            안녕하세요, {getUserDisplayName()}님! 👋
                        </h1>
                        <p className="text-muted-foreground">
                            Robota 대시보드에 오신 것을 환영합니다. 여기서 프로젝트를 관리하고 AI 에이전트를 구축할 수 있습니다.
                        </p>
                    </div>

                    {/* User Profile Card */}
                    <Card>
                        <CardHeader>
                            <CardTitle className="flex items-center gap-2">
                                <User className="h-5 w-5" />
                                프로필 정보
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div className="flex items-center space-x-4">
                                <Avatar className="h-16 w-16">
                                    <AvatarImage src={user?.photoURL || ''} />
                                    <AvatarFallback className="text-lg">
                                        {getInitials(getUserDisplayName())}
                                    </AvatarFallback>
                                </Avatar>

                                <div className="space-y-1">
                                    <h3 className="text-lg font-medium">{getUserDisplayName()}</h3>
                                    <p className="text-sm text-muted-foreground">{user?.email}</p>
                                    <div className="flex items-center gap-2">
                                        <Badge variant="secondary" className="flex items-center gap-1">
                                            <Crown className="h-3 w-3" />
                                            {userProfile?.subscription?.plan || 'Free'}
                                        </Badge>
                                        <Badge variant="outline" className="flex items-center gap-1">
                                            <Calendar className="h-3 w-3" />
                                            가입일: {formatDate(userProfile?.createdAt)}
                                        </Badge>
                                    </div>
                                </div>
                            </div>

                            <div className="flex gap-2">
                                <Button variant="outline" size="sm" asChild>
                                    <Link href="/profile">
                                        <Settings className="h-4 w-4 mr-2" />
                                        프로필 편집
                                    </Link>
                                </Button>
                                <Button variant="outline" size="sm" asChild>
                                    <Link href="/settings">
                                        <Settings className="h-4 w-4 mr-2" />
                                        설정
                                    </Link>
                                </Button>
                            </div>
                        </CardContent>
                    </Card>

                    {/* Quick Actions */}
                    <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
                        <Card className="hover:shadow-md transition-shadow cursor-pointer">
                            <CardHeader>
                                <CardTitle className="flex items-center gap-2">
                                    <Code2 className="h-5 w-5 text-blue-500" />
                                    Playground
                                </CardTitle>
                                <CardDescription>
                                    AI 에이전트를 실시간으로 테스트하고 개발하세요
                                </CardDescription>
                            </CardHeader>
                            <CardContent>
                                <Button asChild>
                                    <Link href="/playground">
                                        시작하기
                                    </Link>
                                </Button>
                            </CardContent>
                        </Card>

                        <Card className="hover:shadow-md transition-shadow cursor-pointer">
                            <CardHeader>
                                <CardTitle className="flex items-center gap-2">
                                    <FileText className="h-5 w-5 text-green-500" />
                                    프로젝트
                                </CardTitle>
                                <CardDescription>
                                    저장된 프로젝트를 관리하고 새로운 프로젝트를 생성하세요
                                </CardDescription>
                            </CardHeader>
                            <CardContent>
                                <Button variant="outline" asChild>
                                    <Link href="/projects">
                                        관리하기
                                    </Link>
                                </Button>
                            </CardContent>
                        </Card>

                        <Card className="hover:shadow-md transition-shadow cursor-pointer">
                            <CardHeader>
                                <CardTitle className="flex items-center gap-2">
                                    <BarChart3 className="h-5 w-5 text-purple-500" />
                                    분석
                                </CardTitle>
                                <CardDescription>
                                    프로젝트 사용량과 성능을 분석하세요
                                </CardDescription>
                            </CardHeader>
                            <CardContent>
                                <Button variant="outline" disabled>
                                    곧 출시 예정
                                </Button>
                            </CardContent>
                        </Card>
                    </div>

                    {/* Statistics */}
                    <div className="grid gap-4 md:grid-cols-4">
                        <Card>
                            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                                <CardTitle className="text-sm font-medium">총 프로젝트</CardTitle>
                                <FileText className="h-4 w-4 text-muted-foreground" />
                            </CardHeader>
                            <CardContent>
                                <div className="text-2xl font-bold">0</div>
                                <p className="text-xs text-muted-foreground">
                                    첫 프로젝트를 만들어보세요
                                </p>
                            </CardContent>
                        </Card>

                        <Card>
                            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                                <CardTitle className="text-sm font-medium">이번 달 실행</CardTitle>
                                <Activity className="h-4 w-4 text-muted-foreground" />
                            </CardHeader>
                            <CardContent>
                                <div className="text-2xl font-bold">0</div>
                                <p className="text-xs text-muted-foreground">
                                    코드 실행 횟수
                                </p>
                            </CardContent>
                        </Card>

                        <Card>
                            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                                <CardTitle className="text-sm font-medium">활성 세션</CardTitle>
                                <Code2 className="h-4 w-4 text-muted-foreground" />
                            </CardHeader>
                            <CardContent>
                                <div className="text-2xl font-bold">1</div>
                                <p className="text-xs text-muted-foreground">
                                    현재 세션
                                </p>
                            </CardContent>
                        </Card>

                        <Card>
                            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                                <CardTitle className="text-sm font-medium">구독 상태</CardTitle>
                                <Crown className="h-4 w-4 text-muted-foreground" />
                            </CardHeader>
                            <CardContent>
                                <div className="text-2xl font-bold">Free</div>
                                <p className="text-xs text-muted-foreground">
                                    무제한 플레이그라운드
                                </p>
                            </CardContent>
                        </Card>
                    </div>
                </div>
            </main>
        </div>
    );
}

export default function DashboardPage() {
    return (
        <ProtectedRoute>
            <DashboardContent />
        </ProtectedRoute>
    );
} 