'use client'

import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
    Activity,
    Clock,
    Zap,
    AlertTriangle,
    CheckCircle,
    RefreshCw,
    TrendingUp,
    Users
} from 'lucide-react';
import { getUserTierConfig } from '@/lib/rate-limiting/rate-limiter';

interface UsageStats {
    subscription: string;
    dailyExecutions: number;
    maxConcurrentSessions: number;
    allowedProviders: string[];
    maxTokens: number;
    currentUsage: {
        dailyExecutions: number;
        activeSessions: number;
        tokensUsed: number;
    };
    features: {
        streaming: boolean;
        tools: boolean;
        customTemplates: boolean;
    };
}

interface RateLimitInfo {
    minute: { remaining: number; limit: number; resetTime: string };
    hour: { remaining: number; limit: number; resetTime: string };
    day: { remaining: number; limit: number; resetTime: string };
}

interface UsageMonitorProps {
    isVisible: boolean;
    onClose?: () => void;
}

export function UsageMonitor({ isVisible, onClose }: UsageMonitorProps) {
    const [usage, setUsage] = useState<UsageStats | null>(null);
    const [rateLimit, setRateLimit] = useState<RateLimitInfo | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [lastUpdate, setLastUpdate] = useState<Date | null>(null);

    useEffect(() => {
        if (isVisible) {
            fetchUsageStats();
            // Refresh every 30 seconds when visible
            const interval = setInterval(fetchUsageStats, 30000);
            return () => clearInterval(interval);
        }
    }, [isVisible]);

    const fetchUsageStats = async () => {
        setIsLoading(true);
        try {
            // This would call the actual API in production
            // For now, we'll simulate the data
            await new Promise(resolve => setTimeout(resolve, 500));

            const mockUsage: UsageStats = {
                subscription: 'free',
                dailyExecutions: 100,
                maxConcurrentSessions: 1,
                allowedProviders: ['openai'],
                maxTokens: 1000,
                currentUsage: {
                    dailyExecutions: Math.floor(Math.random() * 15),
                    activeSessions: Math.floor(Math.random() * 2),
                    tokensUsed: Math.floor(Math.random() * 300)
                },
                features: {
                    streaming: false,
                    tools: false,
                    customTemplates: false
                }
            };

            const mockRateLimit: RateLimitInfo = {
                minute: {
                    remaining: Math.floor(Math.random() * 5),
                    limit: 5,
                    resetTime: new Date(Date.now() + 30000).toISOString()
                },
                hour: {
                    remaining: Math.floor(Math.random() * 50),
                    limit: 50,
                    resetTime: new Date(Date.now() + 1800000).toISOString()
                },
                day: {
                    remaining: Math.floor(Math.random() * 100),
                    limit: 100,
                    resetTime: new Date(Date.now() + 86400000).toISOString()
                }
            };

            setUsage(mockUsage);
            setRateLimit(mockRateLimit);
            setLastUpdate(new Date());

        } catch (error) {
            console.error('Failed to fetch usage stats:', error);
        } finally {
            setIsLoading(false);
        }
    };

    const getUsageColor = (current: number, max: number): string => {
        const percentage = (current / max) * 100;
        if (percentage >= 90) return 'text-red-500';
        if (percentage >= 70) return 'text-yellow-500';
        return 'text-green-500';
    };

    const getProgressColor = (current: number, max: number): string => {
        const percentage = (current / max) * 100;
        if (percentage >= 90) return 'bg-red-500';
        if (percentage >= 70) return 'bg-yellow-500';
        return 'bg-green-500';
    };

    if (!isVisible || !usage || !rateLimit) {
        return null;
    }

    const tierConfig = getUserTierConfig(usage.subscription);

    return (
        <Card className="fixed top-4 right-4 w-80 max-h-[80vh] overflow-auto z-50 shadow-lg">
            <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                    <CardTitle className="text-lg flex items-center gap-2">
                        <Activity className="w-5 h-5" />
                        Usage Monitor
                    </CardTitle>
                    <div className="flex items-center gap-2">
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={fetchUsageStats}
                            disabled={isLoading}
                        >
                            <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
                        </Button>
                        {onClose && (
                            <Button variant="ghost" size="sm" onClick={onClose}>
                                ×
                            </Button>
                        )}
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    <Badge variant={usage.subscription === 'free' ? 'secondary' : 'default'}>
                        {usage.subscription.toUpperCase()}
                    </Badge>
                    {lastUpdate && (
                        <span className="text-xs text-muted-foreground">
                            Updated {lastUpdate.toLocaleTimeString()}
                        </span>
                    )}
                </div>
            </CardHeader>

            <CardContent className="space-y-4">
                {/* Daily Usage */}
                <div>
                    <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                            <TrendingUp className="w-4 h-4" />
                            <span className="text-sm font-medium">Daily Executions</span>
                        </div>
                        <span className={`text-sm ${getUsageColor(usage.currentUsage.dailyExecutions, usage.dailyExecutions)}`}>
                            {usage.currentUsage.dailyExecutions} / {usage.dailyExecutions}
                        </span>
                    </div>
                    <Progress
                        value={(usage.currentUsage.dailyExecutions / usage.dailyExecutions) * 100}
                        className="h-2"
                    />
                </div>

                {/* Active Sessions */}
                <div>
                    <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                            <Users className="w-4 h-4" />
                            <span className="text-sm font-medium">Active Sessions</span>
                        </div>
                        <span className={`text-sm ${getUsageColor(usage.currentUsage.activeSessions, usage.maxConcurrentSessions)}`}>
                            {usage.currentUsage.activeSessions} / {usage.maxConcurrentSessions}
                        </span>
                    </div>
                    <Progress
                        value={(usage.currentUsage.activeSessions / usage.maxConcurrentSessions) * 100}
                        className="h-2"
                    />
                </div>

                {/* Token Usage */}
                <div>
                    <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                            <Zap className="w-4 h-4" />
                            <span className="text-sm font-medium">Tokens Used</span>
                        </div>
                        <span className={`text-sm ${getUsageColor(usage.currentUsage.tokensUsed, usage.maxTokens)}`}>
                            {usage.currentUsage.tokensUsed} / {usage.maxTokens}
                        </span>
                    </div>
                    <Progress
                        value={(usage.currentUsage.tokensUsed / usage.maxTokens) * 100}
                        className="h-2"
                    />
                </div>

                {/* Rate Limits */}
                <div className="pt-3 border-t">
                    <h4 className="text-sm font-medium mb-3 flex items-center gap-2">
                        <Clock className="w-4 h-4" />
                        Rate Limits
                    </h4>

                    <div className="space-y-2">
                        <div className="flex justify-between text-xs">
                            <span>Per Minute</span>
                            <span className={getUsageColor(rateLimit.minute.limit - rateLimit.minute.remaining, rateLimit.minute.limit)}>
                                {rateLimit.minute.remaining} remaining
                            </span>
                        </div>

                        <div className="flex justify-between text-xs">
                            <span>Per Hour</span>
                            <span className={getUsageColor(rateLimit.hour.limit - rateLimit.hour.remaining, rateLimit.hour.limit)}>
                                {rateLimit.hour.remaining} remaining
                            </span>
                        </div>

                        <div className="flex justify-between text-xs">
                            <span>Per Day</span>
                            <span className={getUsageColor(rateLimit.day.limit - rateLimit.day.remaining, rateLimit.day.limit)}>
                                {rateLimit.day.remaining} remaining
                            </span>
                        </div>
                    </div>
                </div>

                {/* Features */}
                <div className="pt-3 border-t">
                    <h4 className="text-sm font-medium mb-3">Available Features</h4>
                    <div className="grid grid-cols-2 gap-2">
                        <div className="flex items-center gap-2">
                            {usage.features.streaming ? (
                                <CheckCircle className="w-4 h-4 text-green-500" />
                            ) : (
                                <AlertTriangle className="w-4 h-4 text-gray-400" />
                            )}
                            <span className="text-xs">Streaming</span>
                        </div>

                        <div className="flex items-center gap-2">
                            {usage.features.tools ? (
                                <CheckCircle className="w-4 h-4 text-green-500" />
                            ) : (
                                <AlertTriangle className="w-4 h-4 text-gray-400" />
                            )}
                            <span className="text-xs">Tools</span>
                        </div>

                        <div className="flex items-center gap-2 col-span-2">
                            {usage.features.customTemplates ? (
                                <CheckCircle className="w-4 h-4 text-green-500" />
                            ) : (
                                <AlertTriangle className="w-4 h-4 text-gray-400" />
                            )}
                            <span className="text-xs">Custom Templates</span>
                        </div>
                    </div>
                </div>

                {/* Upgrade Prompt for Free Users */}
                {usage.subscription === 'free' && (
                    <div className="pt-3 border-t">
                        <div className="text-center p-3 bg-blue-50 dark:bg-blue-950 rounded-lg">
                            <p className="text-xs text-blue-700 dark:text-blue-300 mb-2">
                                Upgrade to unlock more features and higher limits
                            </p>
                            <Button size="sm" className="w-full">
                                Upgrade to Pro
                            </Button>
                        </div>
                    </div>
                )}
            </CardContent>
        </Card>
    );
} 