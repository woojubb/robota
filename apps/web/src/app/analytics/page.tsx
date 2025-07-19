'use client'

import { useState, useEffect } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { Skeleton } from '@/components/ui/skeleton'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
    BarChart,
    Bar,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    Legend,
    PieChart,
    Pie,
    Cell,
    LineChart,
    Line,
    ResponsiveContainer,
    Area,
    AreaChart
} from 'recharts'
import {
    Activity,
    DollarSign,
    TrendingUp,
    Users,
    Clock,
    AlertTriangle,
    Download,
    Zap,
    BarChart3,
    PieChart as PieChartIcon,
    Calendar,
    RefreshCw
} from 'lucide-react'
import { useAuth } from '@/contexts/auth-context'
import { formatCurrency, formatNumber, formatPercentage } from '@/lib/utils'

interface UsageStats {
    totalRequests: number
    totalTokens: number
    totalCost: number
    successRate: number
    averageResponseTime: number
    topProviders: Array<{ provider: string; usage: number; percentage: number }>
    topModels: Array<{ model: string; usage: number; percentage: number }>
    dailyUsage: Array<{ date: string; requests: number; tokens: number; cost: number }>
    errorBreakdown: Array<{ type: string; count: number; percentage: number }>
}

interface RateLimit {
    provider: string
    dailyUsage: number
    monthlyUsage: number
    limits: {
        daily: number
        monthly: number
    }
}

const COLORS = ['#0088FE', '#00C49F', '#FFBB28', '#FF8042', '#8884D8', '#82CA9D']

export default function AnalyticsPage() {
    const { user } = useAuth()
    const [stats, setStats] = useState<UsageStats | null>(null)
    const [rateLimits, setRateLimits] = useState<RateLimit[]>([])
    const [loading, setLoading] = useState(true)
    const [period, setPeriod] = useState('7d')
    const [selectedProvider, setSelectedProvider] = useState<string>('all')
    const [recommendations, setRecommendations] = useState<string[]>([])

    useEffect(() => {
        if (user) {
            fetchAnalytics()
            fetchRateLimits()
        }
    }, [user, period, selectedProvider])

    const fetchAnalytics = async () => {
        try {
            setLoading(true)
            const token = await user?.getIdToken()

            const params = new URLSearchParams({
                period,
                ...(selectedProvider !== 'all' && { provider: selectedProvider })
            })

            const response = await fetch(`/api/v1/usage/stats?${params}`, {
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            })

            if (response.ok) {
                const data = await response.json()
                setStats(data.stats)
            }
        } catch (error) {
            console.error('Failed to fetch analytics:', error)
        } finally {
            setLoading(false)
        }
    }

    const fetchRateLimits = async () => {
        try {
            const token = await user?.getIdToken()
            const response = await fetch('/api/v1/usage/limits', {
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            })

            if (response.ok) {
                const data = await response.json()
                setRateLimits(data.limits)
                setRecommendations(data.recommendations)
            }
        } catch (error) {
            console.error('Failed to fetch rate limits:', error)
        }
    }

    const exportData = async (format: 'json' | 'csv' = 'json') => {
        try {
            const token = await user?.getIdToken()
            const response = await fetch(`/api/v1/usage/export?format=${format}`, {
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            })

            if (response.ok) {
                const blob = await response.blob()
                const url = window.URL.createObjectURL(blob)
                const a = document.createElement('a')
                a.href = url
                a.download = `usage-export.${format}`
                document.body.appendChild(a)
                a.click()
                document.body.removeChild(a)
                window.URL.revokeObjectURL(url)
            }
        } catch (error) {
            console.error('Failed to export data:', error)
        }
    }

    if (!user) {
        return (
            <div className="container mx-auto p-6">
                <div className="text-center">
                    <h1 className="text-2xl font-bold">Sign in required</h1>
                    <p className="text-muted-foreground">Please sign in to view your analytics.</p>
                </div>
            </div>
        )
    }

    return (
        <div className="container mx-auto p-6 space-y-6">
            {/* Header */}
            <div className="flex justify-between items-center">
                <div>
                    <h1 className="text-3xl font-bold">Analytics Dashboard</h1>
                    <p className="text-muted-foreground">
                        Monitor your AI usage, costs, and performance metrics
                    </p>
                </div>
                <div className="flex gap-2">
                    <Select value={period} onValueChange={setPeriod}>
                        <SelectTrigger className="w-32">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="24h">Last 24h</SelectItem>
                            <SelectItem value="7d">Last 7 days</SelectItem>
                            <SelectItem value="30d">Last 30 days</SelectItem>
                            <SelectItem value="90d">Last 90 days</SelectItem>
                        </SelectContent>
                    </Select>
                    <Select value={selectedProvider} onValueChange={setSelectedProvider}>
                        <SelectTrigger className="w-32">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="all">All Providers</SelectItem>
                            <SelectItem value="openai">OpenAI</SelectItem>
                            <SelectItem value="anthropic">Anthropic</SelectItem>
                            <SelectItem value="google">Google</SelectItem>
                        </SelectContent>
                    </Select>
                    <Button onClick={fetchAnalytics} variant="outline" size="sm">
                        <RefreshCw className="h-4 w-4 mr-2" />
                        Refresh
                    </Button>
                    <Button onClick={() => exportData('csv')} variant="outline" size="sm">
                        <Download className="h-4 w-4 mr-2" />
                        Export CSV
                    </Button>
                </div>
            </div>

            {/* Key Metrics Cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Total Requests</CardTitle>
                        <Activity className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                        {loading ? (
                            <Skeleton className="h-8 w-20" />
                        ) : (
                            <>
                                <div className="text-2xl font-bold">
                                    {formatNumber(stats?.totalRequests || 0)}
                                </div>
                                <p className="text-xs text-muted-foreground">
                                    {stats?.successRate !== undefined && (
                                        <span className="text-green-600">
                                            {formatPercentage(stats.successRate)} success rate
                                        </span>
                                    )}
                                </p>
                            </>
                        )}
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Total Tokens</CardTitle>
                        <Zap className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                        {loading ? (
                            <Skeleton className="h-8 w-20" />
                        ) : (
                            <>
                                <div className="text-2xl font-bold">
                                    {formatNumber(stats?.totalTokens || 0)}
                                </div>
                                <p className="text-xs text-muted-foreground">
                                    Avg: {formatNumber((stats?.totalTokens || 0) / Math.max(1, stats?.totalRequests || 1))} per request
                                </p>
                            </>
                        )}
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Total Cost</CardTitle>
                        <DollarSign className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                        {loading ? (
                            <Skeleton className="h-8 w-20" />
                        ) : (
                            <>
                                <div className="text-2xl font-bold">
                                    {formatCurrency(stats?.totalCost || 0)}
                                </div>
                                <p className="text-xs text-muted-foreground">
                                    Avg: {formatCurrency((stats?.totalCost || 0) / Math.max(1, stats?.totalRequests || 1))} per request
                                </p>
                            </>
                        )}
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Avg Response Time</CardTitle>
                        <Clock className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                        {loading ? (
                            <Skeleton className="h-8 w-20" />
                        ) : (
                            <>
                                <div className="text-2xl font-bold">
                                    {Math.round(stats?.averageResponseTime || 0)}ms
                                </div>
                                <p className="text-xs text-muted-foreground">
                                    {stats?.averageResponseTime && stats.averageResponseTime < 2000 ? (
                                        <span className="text-green-600">Excellent</span>
                                    ) : stats?.averageResponseTime && stats.averageResponseTime < 5000 ? (
                                        <span className="text-yellow-600">Good</span>
                                    ) : (
                                        <span className="text-red-600">Needs improvement</span>
                                    )}
                                </p>
                            </>
                        )}
                    </CardContent>
                </Card>
            </div>

            {/* Rate Limits */}
            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <AlertTriangle className="h-5 w-5" />
                        Rate Limits & Usage
                    </CardTitle>
                    <CardDescription>
                        Monitor your usage against plan limits
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <div className="space-y-4">
                        {rateLimits.map((limit) => {
                            const dailyPercentage = (limit.dailyUsage / limit.limits.daily) * 100
                            const monthlyPercentage = (limit.monthlyUsage / limit.limits.monthly) * 100

                            return (
                                <div key={limit.provider} className="space-y-2">
                                    <div className="flex justify-between items-center">
                                        <Badge variant="outline" className="capitalize">
                                            {limit.provider}
                                        </Badge>
                                        <div className="text-sm text-muted-foreground">
                                            Daily: {limit.dailyUsage} / {limit.limits.daily} •
                                            Monthly: {limit.monthlyUsage} / {limit.limits.monthly}
                                        </div>
                                    </div>
                                    <div className="space-y-1">
                                        <div className="flex justify-between text-xs">
                                            <span>Daily Usage</span>
                                            <span>{formatPercentage(dailyPercentage)}</span>
                                        </div>
                                        <Progress
                                            value={dailyPercentage}
                                            className={dailyPercentage > 80 ? "bg-red-100" : dailyPercentage > 60 ? "bg-yellow-100" : "bg-green-100"}
                                        />
                                    </div>
                                </div>
                            )
                        })}
                    </div>

                    {recommendations.length > 0 && (
                        <div className="mt-4 p-4 bg-blue-50 rounded-lg">
                            <h4 className="font-medium text-blue-900 mb-2">Recommendations</h4>
                            <ul className="text-sm text-blue-800 space-y-1">
                                {recommendations.map((rec, index) => (
                                    <li key={index}>• {rec}</li>
                                ))}
                            </ul>
                        </div>
                    )}
                </CardContent>
            </Card>

            {/* Charts */}
            <Tabs defaultValue="usage" className="space-y-4">
                <TabsList>
                    <TabsTrigger value="usage">Usage Trends</TabsTrigger>
                    <TabsTrigger value="providers">Provider Breakdown</TabsTrigger>
                    <TabsTrigger value="models">Model Performance</TabsTrigger>
                    <TabsTrigger value="errors">Error Analysis</TabsTrigger>
                </TabsList>

                <TabsContent value="usage" className="space-y-4">
                    <Card>
                        <CardHeader>
                            <CardTitle>Daily Usage Trends</CardTitle>
                            <CardDescription>
                                Track your usage patterns over time
                            </CardDescription>
                        </CardHeader>
                        <CardContent>
                            {loading ? (
                                <Skeleton className="h-80 w-full" />
                            ) : (
                                <ResponsiveContainer width="100%" height={300}>
                                    <AreaChart data={stats?.dailyUsage || []}>
                                        <CartesianGrid strokeDasharray="3 3" />
                                        <XAxis dataKey="date" />
                                        <YAxis yAxisId="left" orientation="left" />
                                        <YAxis yAxisId="right" orientation="right" />
                                        <Tooltip />
                                        <Legend />
                                        <Area
                                            yAxisId="left"
                                            type="monotone"
                                            dataKey="requests"
                                            stackId="1"
                                            stroke="#8884d8"
                                            fill="#8884d8"
                                            fillOpacity={0.6}
                                        />
                                        <Area
                                            yAxisId="right"
                                            type="monotone"
                                            dataKey="cost"
                                            stackId="2"
                                            stroke="#82ca9d"
                                            fill="#82ca9d"
                                            fillOpacity={0.6}
                                        />
                                    </AreaChart>
                                </ResponsiveContainer>
                            )}
                        </CardContent>
                    </Card>
                </TabsContent>

                <TabsContent value="providers" className="space-y-4">
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                        <Card>
                            <CardHeader>
                                <CardTitle>Provider Usage Distribution</CardTitle>
                            </CardHeader>
                            <CardContent>
                                {loading ? (
                                    <Skeleton className="h-64 w-full" />
                                ) : (
                                    <ResponsiveContainer width="100%" height={250}>
                                        <PieChart>
                                            <Pie
                                                data={stats?.topProviders || []}
                                                cx="50%"
                                                cy="50%"
                                                labelLine={false}
                                                label={({ provider, percentage }) => `${provider} (${formatPercentage(percentage)})`}
                                                outerRadius={80}
                                                fill="#8884d8"
                                                dataKey="usage"
                                            >
                                                {(stats?.topProviders || []).map((entry, index) => (
                                                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                                                ))}
                                            </Pie>
                                            <Tooltip />
                                        </PieChart>
                                    </ResponsiveContainer>
                                )}
                            </CardContent>
                        </Card>

                        <Card>
                            <CardHeader>
                                <CardTitle>Provider Comparison</CardTitle>
                            </CardHeader>
                            <CardContent>
                                {loading ? (
                                    <Skeleton className="h-64 w-full" />
                                ) : (
                                    <ResponsiveContainer width="100%" height={250}>
                                        <BarChart data={stats?.topProviders || []}>
                                            <CartesianGrid strokeDasharray="3 3" />
                                            <XAxis dataKey="provider" />
                                            <YAxis />
                                            <Tooltip />
                                            <Bar dataKey="usage" fill="#8884d8" />
                                        </BarChart>
                                    </ResponsiveContainer>
                                )}
                            </CardContent>
                        </Card>
                    </div>
                </TabsContent>

                <TabsContent value="models" className="space-y-4">
                    <Card>
                        <CardHeader>
                            <CardTitle>Model Performance</CardTitle>
                            <CardDescription>
                                Compare usage across different AI models
                            </CardDescription>
                        </CardHeader>
                        <CardContent>
                            {loading ? (
                                <Skeleton className="h-80 w-full" />
                            ) : (
                                <ResponsiveContainer width="100%" height={300}>
                                    <BarChart data={stats?.topModels || []} layout="horizontal">
                                        <CartesianGrid strokeDasharray="3 3" />
                                        <XAxis type="number" />
                                        <YAxis dataKey="model" type="category" width={120} />
                                        <Tooltip />
                                        <Bar dataKey="usage" fill="#82ca9d" />
                                    </BarChart>
                                </ResponsiveContainer>
                            )}
                        </CardContent>
                    </Card>
                </TabsContent>

                <TabsContent value="errors" className="space-y-4">
                    <Card>
                        <CardHeader>
                            <CardTitle>Error Analysis</CardTitle>
                            <CardDescription>
                                Identify and track error patterns in your requests
                            </CardDescription>
                        </CardHeader>
                        <CardContent>
                            {loading ? (
                                <Skeleton className="h-80 w-full" />
                            ) : stats?.errorBreakdown && stats.errorBreakdown.length > 0 ? (
                                <div className="space-y-4">
                                    <ResponsiveContainer width="100%" height={200}>
                                        <PieChart>
                                            <Pie
                                                data={stats.errorBreakdown}
                                                cx="50%"
                                                cy="50%"
                                                labelLine={false}
                                                label={({ type, percentage }) => `${type} (${formatPercentage(percentage)})`}
                                                outerRadius={80}
                                                fill="#8884d8"
                                                dataKey="count"
                                            >
                                                {stats.errorBreakdown.map((entry, index) => (
                                                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                                                ))}
                                            </Pie>
                                            <Tooltip />
                                        </PieChart>
                                    </ResponsiveContainer>

                                    <div className="space-y-2">
                                        {stats.errorBreakdown.map((error, index) => (
                                            <div key={error.type} className="flex justify-between items-center p-2 bg-gray-50 rounded">
                                                <div className="flex items-center gap-2">
                                                    <div
                                                        className="w-3 h-3 rounded-full"
                                                        style={{ backgroundColor: COLORS[index % COLORS.length] }}
                                                    />
                                                    <span className="font-medium capitalize">{error.type}</span>
                                                </div>
                                                <div className="text-sm text-gray-600">
                                                    {error.count} errors ({formatPercentage(error.percentage)})
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            ) : (
                                <div className="text-center py-8">
                                    <div className="text-green-600 text-lg font-medium">🎉 No Errors!</div>
                                    <p className="text-muted-foreground">
                                        Your requests have been running smoothly with no errors in the selected period.
                                    </p>
                                </div>
                            )}
                        </CardContent>
                    </Card>
                </TabsContent>
            </Tabs>
        </div>
    )
} 