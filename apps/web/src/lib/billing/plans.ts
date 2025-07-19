import { PricingPlan } from '@/types/billing'

export const PRICING_PLANS: Record<string, PricingPlan> = {
    free: {
        id: 'free',
        name: 'free',
        displayName: 'Free',
        description: 'Perfect for getting started and exploring AI capabilities',
        price: {
            monthly: 0,
            yearly: 0,
            currency: 'USD'
        },
        tier: 'free',
        status: 'active',
        features: [
            { id: 'requests', name: '1,000 requests/month', included: true, limit: 1000, unit: 'requests' },
            { id: 'tokens', name: '100K tokens/month', included: true, limit: 100000, unit: 'tokens' },
            { id: 'providers', name: 'All AI providers', included: true },
            { id: 'playground', name: 'Basic playground access', included: true },
            { id: 'analytics', name: 'Basic analytics', included: true },
            { id: 'support', name: 'Community support', included: true },
            { id: 'history', name: '7 days history', included: true, limit: 7, unit: 'days' },
            { id: 'api_keys', name: '1 API key', included: true, limit: 1 },
            { id: 'team', name: 'Team collaboration', included: false },
            { id: 'priority', name: 'Priority support', included: false },
            { id: 'custom', name: 'Custom models', included: false },
            { id: 'webhooks', name: 'Webhooks', included: false },
            { id: 'sso', name: 'SSO', included: false }
        ],
        limits: {
            requests: {
                hourly: 100,
                daily: 200,
                monthly: 1000
            },
            tokens: {
                openai: 30000,
                anthropic: 30000,
                google: 40000,
                total: 100000
            },
            cost: {
                daily: 2,
                monthly: 10
            },
            features: {
                playgroundAccess: true,
                analyticsAccess: true,
                apiKeyManagement: false,
                teamCollaboration: false,
                prioritySupport: false,
                customModels: false,
                webhooks: false,
                sso: false
            },
            rateLimit: {
                requestsPerSecond: 2,
                burstLimit: 5
            },
            storage: {
                conversationHistory: 7,
                analyticsRetention: 7,
                maxProjects: 1,
                maxTeamMembers: 1
            }
        }
    },

    starter: {
        id: 'starter',
        name: 'starter',
        displayName: 'Starter',
        description: 'Ideal for small projects and individual developers',
        price: {
            monthly: 29,
            yearly: 290,
            currency: 'USD'
        },
        tier: 'starter',
        status: 'active',
        popular: true,
        features: [
            { id: 'requests', name: '50,000 requests/month', included: true, limit: 50000, unit: 'requests' },
            { id: 'tokens', name: '2M tokens/month', included: true, limit: 2000000, unit: 'tokens' },
            { id: 'providers', name: 'All AI providers', included: true },
            { id: 'playground', name: 'Full playground access', included: true },
            { id: 'analytics', name: 'Advanced analytics', included: true },
            { id: 'support', name: 'Email support', included: true },
            { id: 'history', name: '30 days history', included: true, limit: 30, unit: 'days' },
            { id: 'api_keys', name: '5 API keys', included: true, limit: 5 },
            { id: 'team', name: 'Team collaboration (3 members)', included: true, limit: 3 },
            { id: 'priority', name: 'Priority support', included: false },
            { id: 'custom', name: 'Custom models', included: false },
            { id: 'webhooks', name: 'Webhooks', included: true },
            { id: 'sso', name: 'SSO', included: false }
        ],
        limits: {
            requests: {
                hourly: 2000,
                daily: 5000,
                monthly: 50000
            },
            tokens: {
                openai: 700000,
                anthropic: 700000,
                google: 600000,
                total: 2000000
            },
            cost: {
                daily: 20,
                monthly: 200
            },
            features: {
                playgroundAccess: true,
                analyticsAccess: true,
                apiKeyManagement: true,
                teamCollaboration: true,
                prioritySupport: false,
                customModels: false,
                webhooks: true,
                sso: false
            },
            rateLimit: {
                requestsPerSecond: 10,
                burstLimit: 25
            },
            storage: {
                conversationHistory: 30,
                analyticsRetention: 30,
                maxProjects: 5,
                maxTeamMembers: 3
            }
        }
    },

    pro: {
        id: 'pro',
        name: 'pro',
        displayName: 'Pro',
        description: 'Perfect for growing teams and production applications',
        price: {
            monthly: 99,
            yearly: 990,
            currency: 'USD'
        },
        tier: 'pro',
        status: 'active',
        features: [
            { id: 'requests', name: '200,000 requests/month', included: true, limit: 200000, unit: 'requests' },
            { id: 'tokens', name: '10M tokens/month', included: true, limit: 10000000, unit: 'tokens' },
            { id: 'providers', name: 'All AI providers', included: true },
            { id: 'playground', name: 'Full playground access', included: true },
            { id: 'analytics', name: 'Advanced analytics', included: true },
            { id: 'support', name: 'Priority support', included: true },
            { id: 'history', name: '90 days history', included: true, limit: 90, unit: 'days' },
            { id: 'api_keys', name: '20 API keys', included: true, limit: 20 },
            { id: 'team', name: 'Team collaboration (10 members)', included: true, limit: 10 },
            { id: 'priority', name: 'Priority support', included: true },
            { id: 'custom', name: 'Custom models', included: true },
            { id: 'webhooks', name: 'Webhooks', included: true },
            { id: 'sso', name: 'SSO (SAML)', included: true }
        ],
        limits: {
            requests: {
                hourly: 8000,
                daily: 20000,
                monthly: 200000
            },
            tokens: {
                openai: 3500000,
                anthropic: 3500000,
                google: 3000000,
                total: 10000000
            },
            cost: {
                daily: 100,
                monthly: 1000
            },
            features: {
                playgroundAccess: true,
                analyticsAccess: true,
                apiKeyManagement: true,
                teamCollaboration: true,
                prioritySupport: true,
                customModels: true,
                webhooks: true,
                sso: true
            },
            rateLimit: {
                requestsPerSecond: 25,
                burstLimit: 50
            },
            storage: {
                conversationHistory: 90,
                analyticsRetention: 90,
                maxProjects: 20,
                maxTeamMembers: 10
            }
        }
    },

    enterprise: {
        id: 'enterprise',
        name: 'enterprise',
        displayName: 'Enterprise',
        description: 'Custom solutions for large organizations',
        price: {
            monthly: 499,
            yearly: 4990,
            currency: 'USD'
        },
        tier: 'enterprise',
        status: 'active',
        features: [
            { id: 'requests', name: 'Unlimited requests', included: true, limit: 'unlimited' },
            { id: 'tokens', name: 'Unlimited tokens', included: true, limit: 'unlimited' },
            { id: 'providers', name: 'All AI providers', included: true },
            { id: 'playground', name: 'Full playground access', included: true },
            { id: 'analytics', name: 'Enterprise analytics', included: true },
            { id: 'support', name: 'Dedicated support', included: true },
            { id: 'history', name: 'Unlimited history', included: true, limit: 'unlimited' },
            { id: 'api_keys', name: 'Unlimited API keys', included: true, limit: 'unlimited' },
            { id: 'team', name: 'Unlimited team members', included: true, limit: 'unlimited' },
            { id: 'priority', name: 'Priority support', included: true },
            { id: 'custom', name: 'Custom models', included: true },
            { id: 'webhooks', name: 'Webhooks', included: true },
            { id: 'sso', name: 'SSO (SAML/OIDC)', included: true },
            { id: 'sla', name: '99.9% SLA', included: true },
            { id: 'onboarding', name: 'Dedicated onboarding', included: true }
        ],
        limits: {
            requests: {
                hourly: 999999999,
                daily: 999999999,
                monthly: 999999999
            },
            tokens: {
                openai: 999999999,
                anthropic: 999999999,
                google: 999999999,
                total: 999999999
            },
            cost: {
                daily: 10000,
                monthly: 50000
            },
            features: {
                playgroundAccess: true,
                analyticsAccess: true,
                apiKeyManagement: true,
                teamCollaboration: true,
                prioritySupport: true,
                customModels: true,
                webhooks: true,
                sso: true
            },
            rateLimit: {
                requestsPerSecond: 100,
                burstLimit: 200
            },
            storage: {
                conversationHistory: 999999999,
                analyticsRetention: 999999999,
                maxProjects: 999999999,
                maxTeamMembers: 999999999
            }
        }
    }
}

export const DEFAULT_PLAN = PRICING_PLANS.free

export function getPlanById(planId: string): PricingPlan | null {
    return PRICING_PLANS[planId] || null
}

export function getAllPlans(): PricingPlan[] {
    return Object.values(PRICING_PLANS).filter(plan => plan.status === 'active')
}

export function getPublicPlans(): PricingPlan[] {
    return getAllPlans().filter(plan => plan.tier !== 'enterprise')
}

export function calculateAnnualSavings(plan: PricingPlan): number {
    const monthlyTotal = plan.price.monthly * 12
    const yearlyTotal = plan.price.yearly
    return monthlyTotal - yearlyTotal
}

export function calculateSavingsPercentage(plan: PricingPlan): number {
    if (plan.price.monthly === 0) return 0
    const monthlyTotal = plan.price.monthly * 12
    const savings = calculateAnnualSavings(plan)
    return Math.round((savings / monthlyTotal) * 100)
} 