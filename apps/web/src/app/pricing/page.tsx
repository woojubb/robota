'use client'

import { useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import { Separator } from '@/components/ui/separator'
import {
    Check,
    X,
    Star,
    Zap,
    Shield,
    Users,
    BarChart3,
    Crown,
    ArrowRight,
    HelpCircle
} from 'lucide-react'
import { useAuth } from '@/contexts/auth-context'
import { PRICING_PLANS, calculateAnnualSavings, calculateSavingsPercentage } from '@/lib/billing/plans'
import { formatCurrency } from '@/lib/utils'
import { PricingPlan } from '@/types/billing'

const FAQ_ITEMS = [
    {
        question: "Can I change my plan at any time?",
        answer: "Yes, you can upgrade or downgrade your plan at any time. Changes take effect immediately, and we'll prorate your billing accordingly."
    },
    {
        question: "What happens if I exceed my plan limits?",
        answer: "We'll send you notifications as you approach your limits. If you exceed them, we'll temporarily pause your requests until you upgrade or the next billing cycle begins."
    },
    {
        question: "Do you offer refunds?",
        answer: "We offer a 14-day money-back guarantee for all paid plans. Contact our support team for assistance."
    },
    {
        question: "Can I use my own API keys?",
        answer: "Yes! You can use your own OpenAI, Anthropic, and Google AI API keys. This gives you direct control over your AI provider billing."
    },
    {
        question: "Is there a free trial?",
        answer: "Our Free plan gives you full access to try out the platform. For paid plans, we offer a 14-day free trial with full features."
    },
    {
        question: "What payment methods do you accept?",
        answer: "We accept all major credit cards (Visa, MasterCard, American Express) and PayPal. Enterprise customers can pay via invoice."
    }
]

export default function PricingPage() {
    const { user } = useAuth()
    const [isYearly, setIsYearly] = useState(false)
    const [hoveredPlan, setHoveredPlan] = useState<string | null>(null)

    const plans = Object.values(PRICING_PLANS).filter(plan => plan.status === 'active')

    const handlePlanSelect = async (plan: PricingPlan) => {
        if (!user) {
            // Redirect to sign up
            window.location.href = '/auth/signup'
            return
        }

        if (plan.tier === 'free') {
            // Handle free plan selection
            console.log('Selected free plan')
            return
        }

        if (plan.tier === 'enterprise') {
            // Redirect to contact sales
            window.location.href = '/contact?plan=enterprise'
            return
        }

        // For now, show coming soon - later integrate with Stripe
        alert(`${plan.displayName} plan coming soon! We'll notify you when payments are available.`)
    }

    const getPlanIcon = (tier: string) => {
        switch (tier) {
            case 'free': return <Zap className="h-6 w-6" />
            case 'starter': return <Star className="h-6 w-6" />
            case 'pro': return <BarChart3 className="h-6 w-6" />
            case 'enterprise': return <Crown className="h-6 w-6" />
            default: return <Zap className="h-6 w-6" />
        }
    }

    const getPlanColor = (tier: string) => {
        switch (tier) {
            case 'free': return 'border-gray-200'
            case 'starter': return 'border-blue-200 ring-2 ring-blue-100'
            case 'pro': return 'border-purple-200'
            case 'enterprise': return 'border-amber-200'
            default: return 'border-gray-200'
        }
    }

    return (
        <div className="min-h-screen bg-gradient-to-b from-gray-50 to-white">
            {/* Header */}
            <div className="container mx-auto px-6 py-16">
                <div className="text-center mb-16">
                    <h1 className="text-4xl md:text-6xl font-bold mb-6">
                        Simple, transparent pricing
                    </h1>
                    <p className="text-xl text-gray-600 mb-8 max-w-2xl mx-auto">
                        Choose the perfect plan for your AI development needs. Start free and scale as you grow.
                    </p>

                    {/* Billing Toggle */}
                    <div className="flex items-center justify-center gap-4 mb-12">
                        <span className={`text-lg ${!isYearly ? 'text-gray-900 font-medium' : 'text-gray-500'}`}>
                            Monthly
                        </span>
                        <Switch
                            checked={isYearly}
                            onCheckedChange={setIsYearly}
                            className="data-[state=checked]:bg-blue-600"
                        />
                        <span className={`text-lg ${isYearly ? 'text-gray-900 font-medium' : 'text-gray-500'}`}>
                            Yearly
                        </span>
                        {isYearly && (
                            <Badge variant="secondary" className="bg-green-100 text-green-700">
                                Save up to 20%
                            </Badge>
                        )}
                    </div>
                </div>

                {/* Pricing Cards */}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8 mb-16">
                    {plans.map((plan) => {
                        const price = isYearly ? plan.price.yearly : plan.price.monthly
                        const billingPeriod = isYearly ? 'year' : 'month'
                        const savings = isYearly ? calculateAnnualSavings(plan) : 0
                        const savingsPercent = isYearly ? calculateSavingsPercentage(plan) : 0

                        return (
                            <Card
                                key={plan.id}
                                className={`relative overflow-hidden transition-all duration-300 ${getPlanColor(plan.tier)} ${hoveredPlan === plan.id ? 'scale-105 shadow-xl' : 'hover:shadow-lg'
                                    } ${plan.popular ? 'ring-2 ring-blue-500' : ''}`}
                                onMouseEnter={() => setHoveredPlan(plan.id)}
                                onMouseLeave={() => setHoveredPlan(null)}
                            >
                                {plan.popular && (
                                    <div className="absolute top-0 left-0 right-0 bg-blue-500 text-white text-center py-2 text-sm font-medium">
                                        Most Popular
                                    </div>
                                )}

                                <CardHeader className={`text-center ${plan.popular ? 'pt-12' : 'pt-6'}`}>
                                    <div className="flex justify-center mb-4">
                                        <div className={`p-3 rounded-full ${plan.tier === 'free' ? 'bg-gray-100' :
                                                plan.tier === 'starter' ? 'bg-blue-100' :
                                                    plan.tier === 'pro' ? 'bg-purple-100' :
                                                        'bg-amber-100'
                                            }`}>
                                            {getPlanIcon(plan.tier)}
                                        </div>
                                    </div>

                                    <CardTitle className="text-2xl font-bold">
                                        {plan.displayName}
                                    </CardTitle>

                                    <CardDescription className="text-gray-600 mt-2">
                                        {plan.description}
                                    </CardDescription>

                                    <div className="mt-6">
                                        <div className="flex items-baseline justify-center">
                                            <span className="text-4xl font-bold">
                                                {price === 0 ? 'Free' : formatCurrency(price)}
                                            </span>
                                            {price > 0 && (
                                                <span className="text-gray-500 ml-2">
                                                    /{billingPeriod}
                                                </span>
                                            )}
                                        </div>

                                        {isYearly && savings > 0 && (
                                            <div className="text-sm text-green-600 mt-2">
                                                Save {formatCurrency(savings)} ({savingsPercent}%)
                                            </div>
                                        )}
                                    </div>
                                </CardHeader>

                                <CardContent className="px-6 pb-6">
                                    <Button
                                        onClick={() => handlePlanSelect(plan)}
                                        className={`w-full mb-6 ${plan.tier === 'free' ? 'bg-gray-900 hover:bg-gray-800' :
                                                plan.tier === 'starter' ? 'bg-blue-600 hover:bg-blue-700' :
                                                    plan.tier === 'pro' ? 'bg-purple-600 hover:bg-purple-700' :
                                                        'bg-amber-600 hover:bg-amber-700'
                                            }`}
                                        disabled={!user && plan.tier !== 'free'}
                                    >
                                        {plan.tier === 'enterprise' ? 'Contact Sales' :
                                            plan.tier === 'free' ? 'Get Started' : 'Start Free Trial'}
                                        <ArrowRight className="ml-2 h-4 w-4" />
                                    </Button>

                                    <div className="space-y-3">
                                        {plan.features.slice(0, 8).map((feature) => (
                                            <div key={feature.id} className="flex items-start gap-3">
                                                {feature.included ? (
                                                    <Check className="h-5 w-5 text-green-500 flex-shrink-0 mt-0.5" />
                                                ) : (
                                                    <X className="h-5 w-5 text-gray-300 flex-shrink-0 mt-0.5" />
                                                )}
                                                <span className={`text-sm ${feature.included ? 'text-gray-900' : 'text-gray-400'
                                                    }`}>
                                                    {feature.name}
                                                </span>
                                            </div>
                                        ))}

                                        {plan.features.length > 8 && (
                                            <div className="text-sm text-gray-500 pt-2">
                                                +{plan.features.length - 8} more features
                                            </div>
                                        )}
                                    </div>
                                </CardContent>
                            </Card>
                        )
                    })}
                </div>

                {/* Feature Comparison Table */}
                <div className="bg-white rounded-2xl shadow-lg p-8 mb-16">
                    <h2 className="text-3xl font-bold text-center mb-8">Compare all features</h2>

                    <div className="overflow-x-auto">
                        <table className="w-full">
                            <thead>
                                <tr className="border-b-2">
                                    <th className="text-left py-4 px-4 font-medium text-gray-600">Features</th>
                                    {plans.map((plan) => (
                                        <th key={plan.id} className="text-center py-4 px-4">
                                            <div className="font-bold">{plan.displayName}</div>
                                            <div className="text-sm text-gray-500">
                                                {plan.price.monthly === 0 ? 'Free' :
                                                    formatCurrency(isYearly ? plan.price.yearly : plan.price.monthly)}
                                                {plan.price.monthly > 0 && `/${isYearly ? 'year' : 'month'}`}
                                            </div>
                                        </th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {/* Group features by category */}
                                <tr className="border-b bg-gray-50">
                                    <td className="py-3 px-4 font-semibold">Usage Limits</td>
                                    <td></td><td></td><td></td><td></td>
                                </tr>
                                <tr className="border-b">
                                    <td className="py-3 px-4">Monthly Requests</td>
                                    {plans.map((plan) => (
                                        <td key={plan.id} className="text-center py-3 px-4">
                                            {plan.limits.requests.monthly.toLocaleString()}
                                        </td>
                                    ))}
                                </tr>
                                <tr className="border-b">
                                    <td className="py-3 px-4">Monthly Tokens</td>
                                    {plans.map((plan) => (
                                        <td key={plan.id} className="text-center py-3 px-4">
                                            {plan.limits.tokens.total === 999999999 ? 'Unlimited' :
                                                (plan.limits.tokens.total / 1000000).toFixed(1) + 'M'}
                                        </td>
                                    ))}
                                </tr>

                                <tr className="border-b bg-gray-50">
                                    <td className="py-3 px-4 font-semibold">Features</td>
                                    <td></td><td></td><td></td><td></td>
                                </tr>
                                <tr className="border-b">
                                    <td className="py-3 px-4">API Keys</td>
                                    {plans.map((plan) => (
                                        <td key={plan.id} className="text-center py-3 px-4">
                                            {plan.limits.storage.maxProjects === 999999999 ? 'Unlimited' :
                                                plan.limits.storage.maxProjects}
                                        </td>
                                    ))}
                                </tr>
                                <tr className="border-b">
                                    <td className="py-3 px-4">Team Members</td>
                                    {plans.map((plan) => (
                                        <td key={plan.id} className="text-center py-3 px-4">
                                            {plan.limits.storage.maxTeamMembers === 999999999 ? 'Unlimited' :
                                                plan.limits.storage.maxTeamMembers}
                                        </td>
                                    ))}
                                </tr>
                                <tr className="border-b">
                                    <td className="py-3 px-4">History Retention</td>
                                    {plans.map((plan) => (
                                        <td key={plan.id} className="text-center py-3 px-4">
                                            {plan.limits.storage.conversationHistory === 999999999 ? 'Unlimited' :
                                                `${plan.limits.storage.conversationHistory} days`}
                                        </td>
                                    ))}
                                </tr>

                                <tr className="border-b bg-gray-50">
                                    <td className="py-3 px-4 font-semibold">Support</td>
                                    <td></td><td></td><td></td><td></td>
                                </tr>
                                <tr className="border-b">
                                    <td className="py-3 px-4">Priority Support</td>
                                    {plans.map((plan) => (
                                        <td key={plan.id} className="text-center py-3 px-4">
                                            {plan.limits.features.prioritySupport ? (
                                                <Check className="h-5 w-5 text-green-500 mx-auto" />
                                            ) : (
                                                <X className="h-5 w-5 text-gray-300 mx-auto" />
                                            )}
                                        </td>
                                    ))}
                                </tr>
                            </tbody>
                        </table>
                    </div>
                </div>

                {/* FAQ Section */}
                <div className="max-w-4xl mx-auto">
                    <h2 className="text-3xl font-bold text-center mb-12">Frequently Asked Questions</h2>

                    <div className="grid gap-6">
                        {FAQ_ITEMS.map((item, index) => (
                            <Card key={index} className="p-6">
                                <div className="flex items-start gap-4">
                                    <HelpCircle className="h-6 w-6 text-blue-500 flex-shrink-0 mt-1" />
                                    <div>
                                        <h3 className="font-semibold text-lg mb-2">{item.question}</h3>
                                        <p className="text-gray-600">{item.answer}</p>
                                    </div>
                                </div>
                            </Card>
                        ))}
                    </div>
                </div>

                {/* CTA Section */}
                <div className="text-center mt-16 p-12 bg-gradient-to-r from-blue-50 to-purple-50 rounded-2xl">
                    <h2 className="text-3xl font-bold mb-4">Ready to get started?</h2>
                    <p className="text-xl text-gray-600 mb-8">
                        Join thousands of developers building with AI
                    </p>
                    <div className="flex flex-col sm:flex-row gap-4 justify-center">
                        <Button size="lg" className="bg-blue-600 hover:bg-blue-700">
                            Start Free Trial
                            <ArrowRight className="ml-2 h-5 w-5" />
                        </Button>
                        <Button size="lg" variant="outline">
                            Contact Sales
                        </Button>
                    </div>
                </div>
            </div>
        </div>
    )
} 