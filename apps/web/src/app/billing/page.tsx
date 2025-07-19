'use client'

import { useState, useEffect } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Separator } from '@/components/ui/separator'
import { Switch } from '@/components/ui/switch'
import {
    CreditCard,
    Download,
    Calendar,
    AlertTriangle,
    CheckCircle,
    TrendingUp,
    Users,
    Zap,
    Crown,
    Star,
    ArrowUpRight,
    Clock,
    DollarSign,
    FileText,
    Settings,
    Bell,
    Shield
} from 'lucide-react'
import { useAuth } from '@/contexts/auth-context'
import { PRICING_PLANS, getPlanById } from '@/lib/billing/plans'
import { formatCurrency, formatNumber, formatPercentage } from '@/lib/utils'
import { UserSubscription, BillingInvoice, UsageAlert } from '@/types/billing'

// Mock data - in real app this would come from API
const MOCK_SUBSCRIPTION: UserSubscription = {
    id: 'sub_123',
    userId: 'user_123',
    planId: 'starter',
    status: 'active',
    createdAt: new Date('2024-01-15'),
    startDate: new Date('2024-01-15'),
    endDate: new Date('2024-12-15'),
    trialEnd: new Date('2024-01-29'),
    billingCycle: 'yearly',
    nextBillingDate: new Date('2024-12-15'),
    amount: 290,
    currency: 'USD',
    currentUsage: {
        period: {
            start: new Date('2024-07-01'),
            end: new Date('2024-07-31')
        },
        requests: {
            total: 15420,
            successful: 15180,
            failed: 240,
            byProvider: {
                openai: 8500,
                anthropic: 4200,
                google: 2720
            }
        },
        tokens: {
            total: 842000,
            byProvider: {
                openai: 450000,
                anthropic: 280000,
                google: 112000
            },
            byModel: {
                'gpt-4': 320000,
                'claude-3-sonnet': 280000,
                'gemini-pro': 112000,
                'gpt-3.5-turbo': 130000
            }
        },
        cost: {
            total: 45.67,
            byProvider: {
                openai: 25.30,
                anthropic: 14.20,
                google: 6.17
            },
            estimatedMonthly: 48.20
        },
        features: {
            playgroundSessions: 156,
            analyticsViews: 89,
            apiKeysCreated: 3,
            projectsCreated: 4
        }
    }
}

const MOCK_INVOICES: BillingInvoice[] = [
    {
        id: 'inv_001',
        userId: 'user_123',
        subscriptionId: 'sub_123',
        invoiceNumber: 'INV-2024-001',
        status: 'paid',
        subtotal: 290.00,
        tax: 0,
        total: 290.00,
        currency: 'USD',
        createdAt: new Date('2024-01-15'),
        dueDate: new Date('2024-01-30'),
        paidAt: new Date('2024-01-16'),
        lineItems: [
            {
                id: 'li_001',
                description: 'Starter Plan - Annual Subscription',
                quantity: 1,
                unitPrice: 290.00,
                amount: 290.00
            }
        ],
        paymentStatus: 'paid',
        paymentMethod: 'card'
    },
    {
        id: 'inv_002',
        userId: 'user_123',
        subscriptionId: 'sub_123',
        invoiceNumber: 'INV-2024-002',
        status: 'paid',
        subtotal: 15.50,
        tax: 0,
        total: 15.50,
        currency: 'USD',
        createdAt: new Date('2024-06-01'),
        dueDate: new Date('2024-06-15'),
        paidAt: new Date('2024-06-02'),
        lineItems: [
            {
                id: 'li_002',
                description: 'Additional API Usage - May 2024',
                quantity: 1550,
                unitPrice: 0.01,
                amount: 15.50,
                usageType: 'requests',
                usageStart: new Date('2024-05-01'),
                usageEnd: new Date('2024-05-31'),
                usageQuantity: 1550
            }
        ],
        paymentStatus: 'paid',
        paymentMethod: 'card'
    }
]

const MOCK_ALERTS: UsageAlert[] = [
    {
        id: 'alert_001',
        userId: 'user_123',
        type: 'usage_threshold',
        severity: 'warning',
        title: 'Approaching Monthly Request Limit',
        message: 'You have used 80% of your monthly request limit. Consider upgrading to avoid service interruption.',
        threshold: 80,
        currentValue: 82.5,
        unit: '%',
        triggeredAt: new Date('2024-07-25'),
        acknowledged: false,
        actions: [
            { label: 'Upgrade Plan', action: 'upgrade_plan', url: '/billing?upgrade=pro' },
            { label: 'View Usage', action: 'view_usage', url: '/analytics' }
        ]
    },
    {
        id: 'alert_002',
        userId: 'user_123',
        type: 'cost_threshold',
        severity: 'info',
        title: 'Monthly Cost Update',
        message: 'Your estimated monthly cost is $48.20, which is within your expected range.',
        threshold: 50,
        currentValue: 48.20,
        unit: 'USD',
        triggeredAt: new Date('2024-07-20'),
        acknowledged: true,
        acknowledgedAt: new Date('2024-07-21')
    }
]

export default function BillingPage() {
    const { user } = useAuth()
    const [subscription, setSubscription] = useState<UserSubscription | null>(null)
    const [invoices, setInvoices] = useState<BillingInvoice[]>([])
    const [alerts, setAlerts] = useState<UsageAlert[]>([])
    const [loading, setLoading] = useState(true)
    const [billingCycle, setBillingCycle] = useState<'monthly' | 'yearly'>('yearly')

    useEffect(() => {
        if (user) {
            loadBillingData()
        }
    }, [user])

    const loadBillingData = async () => {
        try {
            setLoading(true)
            // Simulate API call
            await new Promise(resolve => setTimeout(resolve, 1000))

            setSubscription(MOCK_SUBSCRIPTION)
            setInvoices(MOCK_INVOICES)
            setAlerts(MOCK_ALERTS)
            setBillingCycle(MOCK_SUBSCRIPTION.billingCycle)
        } catch (error) {
            console.error('Failed to load billing data:', error)
        } finally {
            setLoading(false)
        }
    }

    const handlePlanChange = (newPlanId: string) => {
        // In real app, this would integrate with payment processing
        alert(`Plan change to ${newPlanId} will be available when payment integration is complete.`)
    }

    const handleCancelSubscription = () => {
        if (confirm('Are you sure you want to cancel your subscription? You will lose access to premium features at the end of your billing period.')) {
            alert('Subscription cancellation will be available when payment integration is complete.')
        }
    }

    const acknowledgeAlert = async (alertId: string) => {
        setAlerts(prev => prev.map(alert =>
            alert.id === alertId
                ? { ...alert, acknowledged: true, acknowledgedAt: new Date() }
                : alert
        ))
    }

    if (!user) {
        return (
            <div className="container mx-auto p-6">
                <div className="text-center">
                    <h1 className="text-2xl font-bold">Sign in required</h1>
                    <p className="text-muted-foreground">Please sign in to view your billing information.</p>
                </div>
            </div>
        )
    }

    if (loading) {
        return (
            <div className="container mx-auto p-6">
                <div className="flex items-center justify-center min-h-96">
                    <div className="text-center">
                        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
                        <p>Loading billing information...</p>
                    </div>
                </div>
            </div>
        )
    }

    const currentPlan = subscription ? getPlanById(subscription.planId) : null
    const usagePercent = subscription ? {
        requests: (subscription.currentUsage.requests.total / (currentPlan?.limits.requests.monthly || 1)) * 100,
        tokens: (subscription.currentUsage.tokens.total / (currentPlan?.limits.tokens.total || 1)) * 100,
        cost: (subscription.currentUsage.cost.total / (currentPlan?.limits.cost.monthly || 1)) * 100
    } : { requests: 0, tokens: 0, cost: 0 }

    return (
        <div className="container mx-auto p-6 space-y-6">
            {/* Header */}
            <div className="flex justify-between items-center">
                <div>
                    <h1 className="text-3xl font-bold">Billing & Subscription</h1>
                    <p className="text-muted-foreground">
                        Manage your subscription, view usage, and download invoices
                    </p>
                </div>
                <Button variant="outline">
                    <Settings className="h-4 w-4 mr-2" />
                    Billing Settings
                </Button>
            </div>

            {/* Alerts */}
            {alerts.filter(alert => !alert.acknowledged).length > 0 && (
                <div className="space-y-4">
                    {alerts.filter(alert => !alert.acknowledged).map((alert) => (
                        <Card key={alert.id} className={`border-l-4 ${alert.severity === 'critical' ? 'border-l-red-500 bg-red-50' :
                                alert.severity === 'warning' ? 'border-l-yellow-500 bg-yellow-50' :
                                    'border-l-blue-500 bg-blue-50'
                            }`}>
                            <CardContent className="p-4">
                                <div className="flex items-start justify-between">
                                    <div className="flex items-start gap-3">
                                        <AlertTriangle className={`h-5 w-5 mt-0.5 ${alert.severity === 'critical' ? 'text-red-500' :
                                                alert.severity === 'warning' ? 'text-yellow-500' :
                                                    'text-blue-500'
                                            }`} />
                                        <div>
                                            <h3 className="font-semibold">{alert.title}</h3>
                                            <p className="text-sm text-gray-600 mt-1">{alert.message}</p>
                                            {alert.actions && (
                                                <div className="flex gap-2 mt-3">
                                                    {alert.actions.map((action, index) => (
                                                        <Button key={index} size="sm" variant="outline">
                                                            {action.label}
                                                        </Button>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        onClick={() => acknowledgeAlert(alert.id)}
                                    >
                                        Dismiss
                                    </Button>
                                </div>
                            </CardContent>
                        </Card>
                    ))}
                </div>
            )}

            {/* Current Plan & Usage */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* Current Plan */}
                <Card className="lg:col-span-2">
                    <CardHeader>
                        <div className="flex items-center justify-between">
                            <div>
                                <CardTitle className="flex items-center gap-2">
                                    {currentPlan?.tier === 'free' && <Zap className="h-5 w-5" />}
                                    {currentPlan?.tier === 'starter' && <Star className="h-5 w-5" />}
                                    {currentPlan?.tier === 'pro' && <Crown className="h-5 w-5" />}
                                    {currentPlan?.displayName} Plan
                                </CardTitle>
                                <CardDescription>
                                    {subscription?.status === 'active' ? 'Active subscription' :
                                        subscription?.status === 'trial' ? 'Free trial' :
                                            'Inactive subscription'}
                                </CardDescription>
                            </div>
                            <Badge variant={subscription?.status === 'active' ? 'default' : 'secondary'}>
                                {subscription?.status}
                            </Badge>
                        </div>
                    </CardHeader>
                    <CardContent className="space-y-6">
                        <div className="flex items-center justify-between">
                            <div>
                                <div className="text-2xl font-bold">
                                    {formatCurrency(subscription?.amount || 0)}
                                </div>
                                <div className="text-sm text-muted-foreground">
                                    per {subscription?.billingCycle}
                                </div>
                            </div>
                            <div className="text-right">
                                <div className="text-sm font-medium">Next billing date</div>
                                <div className="text-sm text-muted-foreground">
                                    {subscription?.nextBillingDate?.toLocaleDateString()}
                                </div>
                            </div>
                        </div>

                        <Separator />

                        {/* Usage Progress */}
                        <div className="space-y-4">
                            <h4 className="font-semibold">Current Usage</h4>

                            <div className="space-y-3">
                                <div>
                                    <div className="flex justify-between text-sm mb-1">
                                        <span>API Requests</span>
                                        <span>{formatNumber(subscription?.currentUsage.requests.total || 0)} / {formatNumber(currentPlan?.limits.requests.monthly || 0)}</span>
                                    </div>
                                    <Progress value={usagePercent.requests} className="h-2" />
                                </div>

                                <div>
                                    <div className="flex justify-between text-sm mb-1">
                                        <span>Tokens Used</span>
                                        <span>{formatNumber(subscription?.currentUsage.tokens.total || 0)} / {formatNumber(currentPlan?.limits.tokens.total || 0)}</span>
                                    </div>
                                    <Progress value={usagePercent.tokens} className="h-2" />
                                </div>

                                <div>
                                    <div className="flex justify-between text-sm mb-1">
                                        <span>Monthly Cost</span>
                                        <span>{formatCurrency(subscription?.currentUsage.cost.total || 0)} / {formatCurrency(currentPlan?.limits.cost.monthly || 0)}</span>
                                    </div>
                                    <Progress value={usagePercent.cost} className="h-2" />
                                </div>
                            </div>
                        </div>

                        <div className="flex gap-2">
                            <Button
                                variant="outline"
                                className="flex-1"
                                onClick={() => handlePlanChange('pro')}
                            >
                                <ArrowUpRight className="h-4 w-4 mr-2" />
                                Upgrade Plan
                            </Button>
                            <Button
                                variant="outline"
                                onClick={handleCancelSubscription}
                            >
                                Cancel
                            </Button>
                        </div>
                    </CardContent>
                </Card>

                {/* Usage Summary */}
                <div className="space-y-4">
                    <Card>
                        <CardHeader className="pb-3">
                            <CardTitle className="text-lg">This Month</CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                    <Zap className="h-4 w-4 text-blue-500" />
                                    <span className="text-sm">Requests</span>
                                </div>
                                <span className="font-semibold">
                                    {formatNumber(subscription?.currentUsage.requests.total || 0)}
                                </span>
                            </div>

                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                    <TrendingUp className="h-4 w-4 text-green-500" />
                                    <span className="text-sm">Success Rate</span>
                                </div>
                                <span className="font-semibold">
                                    {formatPercentage((subscription?.currentUsage.requests.successful || 0) / Math.max(1, subscription?.currentUsage.requests.total || 1) * 100)}
                                </span>
                            </div>

                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                    <DollarSign className="h-4 w-4 text-purple-500" />
                                    <span className="text-sm">Total Cost</span>
                                </div>
                                <span className="font-semibold">
                                    {formatCurrency(subscription?.currentUsage.cost.total || 0)}
                                </span>
                            </div>
                        </CardContent>
                    </Card>

                    <Card>
                        <CardHeader className="pb-3">
                            <CardTitle className="text-lg">Features Used</CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-3">
                            <div className="flex justify-between text-sm">
                                <span>Playground Sessions</span>
                                <span className="font-medium">{subscription?.currentUsage.features.playgroundSessions}</span>
                            </div>
                            <div className="flex justify-between text-sm">
                                <span>Analytics Views</span>
                                <span className="font-medium">{subscription?.currentUsage.features.analyticsViews}</span>
                            </div>
                            <div className="flex justify-between text-sm">
                                <span>API Keys</span>
                                <span className="font-medium">{subscription?.currentUsage.features.apiKeysCreated}</span>
                            </div>
                            <div className="flex justify-between text-sm">
                                <span>Projects</span>
                                <span className="font-medium">{subscription?.currentUsage.features.projectsCreated}</span>
                            </div>
                        </CardContent>
                    </Card>
                </div>
            </div>

            {/* Tabs for detailed information */}
            <Tabs defaultValue="invoices" className="space-y-4">
                <TabsList>
                    <TabsTrigger value="invoices">Billing History</TabsTrigger>
                    <TabsTrigger value="usage">Detailed Usage</TabsTrigger>
                    <TabsTrigger value="settings">Settings</TabsTrigger>
                </TabsList>

                <TabsContent value="invoices" className="space-y-4">
                    <Card>
                        <CardHeader>
                            <div className="flex items-center justify-between">
                                <CardTitle>Invoices</CardTitle>
                                <Button variant="outline" size="sm">
                                    <Download className="h-4 w-4 mr-2" />
                                    Download All
                                </Button>
                            </div>
                        </CardHeader>
                        <CardContent>
                            <div className="space-y-4">
                                {invoices.map((invoice) => (
                                    <div key={invoice.id} className="flex items-center justify-between p-4 border rounded-lg">
                                        <div className="flex items-center gap-4">
                                            <FileText className="h-8 w-8 text-blue-500" />
                                            <div>
                                                <div className="font-medium">{invoice.invoiceNumber}</div>
                                                <div className="text-sm text-muted-foreground">
                                                    {invoice.createdAt.toLocaleDateString()}
                                                </div>
                                            </div>
                                        </div>

                                        <div className="flex items-center gap-4">
                                            <div className="text-right">
                                                <div className="font-semibold">
                                                    {formatCurrency(invoice.total)}
                                                </div>
                                                <Badge variant={invoice.status === 'paid' ? 'default' : 'secondary'}>
                                                    {invoice.status}
                                                </Badge>
                                            </div>
                                            <Button variant="outline" size="sm">
                                                <Download className="h-4 w-4" />
                                            </Button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </CardContent>
                    </Card>
                </TabsContent>

                <TabsContent value="usage" className="space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                        {/* Provider Usage */}
                        <Card>
                            <CardHeader>
                                <CardTitle className="text-lg">By Provider</CardTitle>
                            </CardHeader>
                            <CardContent className="space-y-3">
                                {Object.entries(subscription?.currentUsage.requests.byProvider || {}).map(([provider, requests]) => (
                                    <div key={provider} className="flex justify-between">
                                        <span className="capitalize">{provider}</span>
                                        <span className="font-medium">{formatNumber(requests)}</span>
                                    </div>
                                ))}
                            </CardContent>
                        </Card>

                        {/* Token Usage */}
                        <Card>
                            <CardHeader>
                                <CardTitle className="text-lg">Token Usage</CardTitle>
                            </CardHeader>
                            <CardContent className="space-y-3">
                                {Object.entries(subscription?.currentUsage.tokens.byProvider || {}).map(([provider, tokens]) => (
                                    <div key={provider} className="flex justify-between">
                                        <span className="capitalize">{provider}</span>
                                        <span className="font-medium">{formatNumber(tokens)}</span>
                                    </div>
                                ))}
                            </CardContent>
                        </Card>

                        {/* Cost Breakdown */}
                        <Card>
                            <CardHeader>
                                <CardTitle className="text-lg">Cost by Provider</CardTitle>
                            </CardHeader>
                            <CardContent className="space-y-3">
                                {Object.entries(subscription?.currentUsage.cost.byProvider || {}).map(([provider, cost]) => (
                                    <div key={provider} className="flex justify-between">
                                        <span className="capitalize">{provider}</span>
                                        <span className="font-medium">{formatCurrency(cost)}</span>
                                    </div>
                                ))}
                            </CardContent>
                        </Card>
                    </div>
                </TabsContent>

                <TabsContent value="settings" className="space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <Card>
                            <CardHeader>
                                <CardTitle>Billing Preferences</CardTitle>
                            </CardHeader>
                            <CardContent className="space-y-4">
                                <div className="flex items-center justify-between">
                                    <div>
                                        <label className="text-sm font-medium">Email Notifications</label>
                                        <p className="text-sm text-muted-foreground">Receive billing updates via email</p>
                                    </div>
                                    <Switch defaultChecked />
                                </div>

                                <div className="flex items-center justify-between">
                                    <div>
                                        <label className="text-sm font-medium">Usage Alerts</label>
                                        <p className="text-sm text-muted-foreground">Get notified when approaching limits</p>
                                    </div>
                                    <Switch defaultChecked />
                                </div>

                                <div className="flex items-center justify-between">
                                    <div>
                                        <label className="text-sm font-medium">Auto-Renewal</label>
                                        <p className="text-sm text-muted-foreground">Automatically renew subscription</p>
                                    </div>
                                    <Switch defaultChecked />
                                </div>
                            </CardContent>
                        </Card>

                        <Card>
                            <CardHeader>
                                <CardTitle>Payment Method</CardTitle>
                            </CardHeader>
                            <CardContent className="space-y-4">
                                <div className="flex items-center gap-3 p-3 border rounded-lg">
                                    <CreditCard className="h-8 w-8 text-blue-500" />
                                    <div>
                                        <div className="font-medium">**** **** **** 4242</div>
                                        <div className="text-sm text-muted-foreground">Expires 12/26</div>
                                    </div>
                                </div>

                                <Button variant="outline" className="w-full">
                                    Update Payment Method
                                </Button>
                            </CardContent>
                        </Card>
                    </div>
                </TabsContent>
            </Tabs>
        </div>
    )
} 