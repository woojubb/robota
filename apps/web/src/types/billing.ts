export interface PricingPlan {
    id: string
    name: string
    displayName: string
    description: string
    price: {
        monthly: number
        yearly: number
        currency: string
    }
    features: PlanFeature[]
    limits: PlanLimits
    popular?: boolean
    tier: 'free' | 'starter' | 'pro' | 'enterprise'
    status: 'active' | 'deprecated' | 'coming_soon'
    metadata?: Record<string, any>
}

export interface PlanFeature {
    id: string
    name: string
    description?: string
    included: boolean
    limit?: number | 'unlimited'
    unit?: string
}

export interface PlanLimits {
    // API Usage Limits
    requests: {
        hourly: number
        daily: number
        monthly: number
    }

    // Token Limits (per provider)
    tokens: {
        openai: number
        anthropic: number
        google: number
        total: number
    }

    // Cost Limits (in USD)
    cost: {
        daily: number
        monthly: number
    }

    // Feature Limits
    features: {
        playgroundAccess: boolean
        analyticsAccess: boolean
        apiKeyManagement: boolean
        teamCollaboration: boolean
        prioritySupport: boolean
        customModels: boolean
        webhooks: boolean
        sso: boolean
    }

    // Rate Limiting
    rateLimit: {
        requestsPerSecond: number
        burstLimit: number
    }

    // Storage and Data
    storage: {
        conversationHistory: number // days
        analyticsRetention: number // days
        maxProjects: number
        maxTeamMembers: number
    }
}

export interface UserSubscription {
    id: string
    userId: string
    planId: string
    status: 'active' | 'canceled' | 'past_due' | 'trial' | 'incomplete'

    // Subscription Timing
    createdAt: Date
    startDate: Date
    endDate?: Date
    trialEnd?: Date
    canceledAt?: Date

    // Billing
    billingCycle: 'monthly' | 'yearly'
    nextBillingDate?: Date
    amount: number
    currency: string

    // Usage Tracking
    currentUsage: UsageMetrics

    // Metadata
    metadata?: Record<string, any>
    paymentMethodId?: string // For future Stripe integration
    customerId?: string // For future Stripe integration
}

export interface UsageMetrics {
    period: {
        start: Date
        end: Date
    }

    // Request Metrics
    requests: {
        total: number
        successful: number
        failed: number
        byProvider: Record<string, number>
    }

    // Token Metrics  
    tokens: {
        total: number
        byProvider: Record<string, number>
        byModel: Record<string, number>
    }

    // Cost Metrics
    cost: {
        total: number
        byProvider: Record<string, number>
        estimatedMonthly: number
    }

    // Feature Usage
    features: {
        playgroundSessions: number
        analyticsViews: number
        apiKeysCreated: number
        projectsCreated: number
    }
}

export interface BillingInvoice {
    id: string
    userId: string
    subscriptionId: string

    // Invoice Details
    invoiceNumber: string
    status: 'draft' | 'open' | 'paid' | 'void' | 'uncollectible'

    // Amounts
    subtotal: number
    tax: number
    total: number
    currency: string

    // Timing
    createdAt: Date
    dueDate: Date
    paidAt?: Date

    // Line Items
    lineItems: InvoiceLineItem[]

    // Payment
    paymentStatus: 'pending' | 'paid' | 'failed' | 'refunded'
    paymentMethod?: string

    // Files
    pdfUrl?: string
    downloadUrl?: string

    // Metadata
    metadata?: Record<string, any>
}

export interface InvoiceLineItem {
    id: string
    description: string
    quantity: number
    unitPrice: number
    amount: number

    // Usage-based billing
    usageType?: 'requests' | 'tokens' | 'storage'
    usageStart?: Date
    usageEnd?: Date
    usageQuantity?: number

    // Metadata
    metadata?: Record<string, any>
}

export interface BillingSettings {
    userId: string

    // Billing Information
    billingEmail: string
    companyName?: string
    vatNumber?: string

    // Address
    address?: {
        line1: string
        line2?: string
        city: string
        state?: string
        postalCode: string
        country: string
    }

    // Preferences
    preferences: {
        emailNotifications: boolean
        usageAlerts: boolean
        billingAlerts: boolean
        marketingEmails: boolean
    }

    // Notifications
    notifications: {
        usageThreshold: number // percentage
        costThreshold: number // USD
        daysBeforeBilling: number
    }

    // Payment (for future Stripe integration)
    defaultPaymentMethodId?: string

    // Metadata
    metadata?: Record<string, any>
    updatedAt: Date
}

export interface PlanComparison {
    currentPlan: PricingPlan
    targetPlan: PricingPlan
    changes: {
        features: {
            added: PlanFeature[]
            removed: PlanFeature[]
            modified: Array<{
                feature: PlanFeature
                oldLimit: number | 'unlimited'
                newLimit: number | 'unlimited'
            }>
        }
        limits: {
            increased: string[]
            decreased: string[]
        }
        pricing: {
            monthlyDiff: number
            yearlyDiff: number
            effectiveDate: Date
        }
    }
}

export interface UsageAlert {
    id: string
    userId: string
    type: 'usage_threshold' | 'cost_threshold' | 'rate_limit' | 'plan_limit'
    severity: 'info' | 'warning' | 'critical'

    // Alert Details
    title: string
    message: string

    // Thresholds
    threshold: number
    currentValue: number
    unit: string

    // Timing
    triggeredAt: Date
    acknowledged: boolean
    acknowledgedAt?: Date

    // Actions
    actions?: Array<{
        label: string
        action: 'upgrade_plan' | 'view_usage' | 'contact_support'
        url?: string
    }>

    // Metadata
    metadata?: Record<string, any>
}

// Utility Types
export type BillingPeriod = 'monthly' | 'yearly'
export type PlanTier = 'free' | 'starter' | 'pro' | 'enterprise'
export type UsageType = 'requests' | 'tokens' | 'cost' | 'storage'
export type AlertType = 'usage_threshold' | 'cost_threshold' | 'rate_limit' | 'plan_limit'

// API Response Types
export interface BillingApiResponse<T = any> {
    success: boolean
    data?: T
    error?: string
    message?: string
    timestamp: string
}

export interface PlanUpgradeResponse {
    success: boolean
    newPlan: PricingPlan
    effectiveDate: Date
    prorationAmount?: number
    nextBillingDate?: Date
    message: string
}

export interface UsageQuotaResponse {
    allowed: boolean
    remaining: {
        requests: number
        tokens: number
        cost: number
    }
    resetTime: Date
    upgrade?: {
        recommended: boolean
        suggestedPlan: string
        reason: string
    }
} 