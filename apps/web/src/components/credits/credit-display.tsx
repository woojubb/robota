'use client';

import { useAuth } from '@/contexts/auth-context';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
// import { Progress } from '@/components/ui/progress';
import {
    Coins,
    CreditCard,
    TrendingUp,
    Calendar,
    RefreshCw
} from 'lucide-react';
import Link from 'next/link';

interface CreditDisplayProps {
    showDetails?: boolean;
    compact?: boolean;
}

export function CreditDisplay({ showDetails = false, compact = false }: CreditDisplayProps) {
    const { creditSummary, userExtended, loading } = useAuth();

    if (loading) {
        return (
            <Card className={compact ? "w-full" : "w-full max-w-md"}>
                <CardContent className="p-4">
                    <div className="animate-pulse space-y-3">
                        <div className="h-4 bg-muted rounded w-3/4"></div>
                        <div className="h-8 bg-muted rounded"></div>
                        <div className="h-4 bg-muted rounded w-1/2"></div>
                    </div>
                </CardContent>
            </Card>
        );
    }

    if (!creditSummary || !userExtended) {
        return (
            <Card className={compact ? "w-full" : "w-full max-w-md"}>
                <CardContent className="p-4">
                    <div className="text-center text-muted-foreground">
                        <Coins className="h-8 w-8 mx-auto mb-2 opacity-50" />
                        <p className="text-sm">크레딧 정보를 불러올 수 없습니다</p>
                    </div>
                </CardContent>
            </Card>
        );
    }

    const { available_credits, subscription_plan, recent_usage, estimated_days_remaining } = creditSummary;

    // Calculate usage percentage for the progress bar
    const totalCredits = userExtended.credits.total_purchased + userExtended.credits.available;
    const usagePercentage = totalCredits > 0 ? ((totalCredits - available_credits) / totalCredits) * 100 : 0;

    const getPlanColor = (plan: string) => {
        switch (plan) {
            case 'pro': return 'bg-blue-500';
            case 'enterprise': return 'bg-purple-500';
            case 'starter': return 'bg-green-500';
            default: return 'bg-gray-500';
        }
    };

    const getPlanLabel = (plan: string) => {
        switch (plan) {
            case 'free': return '무료';
            case 'starter': return '스타터';
            case 'pro': return '프로';
            case 'enterprise': return '엔터프라이즈';
            default: return plan;
        }
    };

    if (compact) {
        return (
            <div className="flex items-center gap-3 p-2 rounded-lg border">
                <div className="flex items-center gap-2">
                    <Coins className="h-4 w-4 text-yellow-500" />
                    <span className="font-medium">{available_credits.toLocaleString()}</span>
                </div>
                <Badge variant="secondary" className={getPlanColor(subscription_plan)}>
                    {getPlanLabel(subscription_plan)}
                </Badge>
            </div>
        );
    }

    return (
        <Card className="w-full max-w-md">
            <CardContent className="p-6 space-y-4">
                {/* Header */}
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <Coins className="h-5 w-5 text-yellow-500" />
                        <h3 className="font-semibold">크레딧</h3>
                    </div>
                    <Badge
                        variant="secondary"
                        className={`${getPlanColor(subscription_plan)} text-white`}
                    >
                        {getPlanLabel(subscription_plan)}
                    </Badge>
                </div>

                {/* Available Credits */}
                <div className="text-center">
                    <div className="text-3xl font-bold text-primary">
                        {available_credits.toLocaleString()}
                    </div>
                    <p className="text-sm text-muted-foreground">사용 가능한 크레딧</p>
                </div>

                {/* Usage Progress */}
                {totalCredits > 0 && (
                    <div className="space-y-2">
                        <div className="flex justify-between text-sm">
                            <span>사용량</span>
                            <span>{Math.round(usagePercentage)}%</span>
                        </div>
                        <div className="w-full bg-muted rounded-full h-2">
                            <div
                                className="bg-primary h-2 rounded-full transition-all duration-300"
                                style={{ width: `${usagePercentage}%` }}
                            />
                        </div>
                    </div>
                )}

                {showDetails && (
                    <>
                        {/* Statistics */}
                        <div className="grid grid-cols-2 gap-4 pt-2">
                            <div className="text-center p-3 bg-muted/50 rounded-lg">
                                <TrendingUp className="h-4 w-4 mx-auto mb-1 text-orange-500" />
                                <div className="text-sm font-medium">{recent_usage}</div>
                                <div className="text-xs text-muted-foreground">30일 사용량</div>
                            </div>

                            {estimated_days_remaining && (
                                <div className="text-center p-3 bg-muted/50 rounded-lg">
                                    <Calendar className="h-4 w-4 mx-auto mb-1 text-blue-500" />
                                    <div className="text-sm font-medium">{estimated_days_remaining}일</div>
                                    <div className="text-xs text-muted-foreground">예상 잔여</div>
                                </div>
                            )}
                        </div>

                        {/* Action Buttons */}
                        <div className="flex gap-2 pt-2">
                            <Button variant="outline" size="sm" className="flex-1" asChild>
                                <Link href="/billing/credits">
                                    <CreditCard className="h-4 w-4 mr-2" />
                                    충전
                                </Link>
                            </Button>
                            <Button variant="outline" size="sm" className="flex-1" asChild>
                                <Link href="/billing/usage">
                                    <RefreshCw className="h-4 w-4 mr-2" />
                                    사용 내역
                                </Link>
                            </Button>
                        </div>
                    </>
                )}
            </CardContent>
        </Card>
    );
}

// Simplified credit indicator for navigation bars
export function CreditIndicator() {
    const { creditSummary, loading } = useAuth();

    if (loading || !creditSummary) {
        return (
            <div className="flex items-center gap-2 px-3 py-1 rounded-full bg-muted">
                <Coins className="h-4 w-4 animate-pulse" />
                <span className="text-sm">--</span>
            </div>
        );
    }

    const { available_credits } = creditSummary;
    const isLow = available_credits < 10;

    return (
        <Link href="/billing/credits">
            <div className={`flex items-center gap-2 px-3 py-1 rounded-full transition-colors hover:bg-muted ${isLow ? 'bg-red-50 text-red-600 dark:bg-red-950 dark:text-red-400' : 'bg-muted'
                }`}>
                <Coins className={`h-4 w-4 ${isLow ? 'text-red-500' : 'text-yellow-500'}`} />
                <span className="text-sm font-medium">
                    {available_credits.toLocaleString()}
                </span>
                {isLow && (
                    <Badge variant="destructive" className="text-xs px-1 py-0">
                        낮음
                    </Badge>
                )}
            </div>
        </Link>
    );
} 