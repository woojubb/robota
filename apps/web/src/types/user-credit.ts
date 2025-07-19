/**
 * User credit and subscription types for Robota platform
 */

export type CreditTransactionType = 'purchase' | 'usage' | 'bonus' | 'refund';
export type SubscriptionPlan = 'free' | 'starter' | 'pro' | 'enterprise';
export type SubscriptionStatus = 'active' | 'inactive' | 'cancelled' | 'past_due';

/**
 * Extended user information stored in Firestore
 */
export interface UserExtended {
    uid: string;
    email: string;
    displayName: string;

    // Credit information
    credits: {
        available: number;      // Currently available credits
        total_purchased: number; // Total credits ever purchased
        total_used: number;     // Total credits ever used
        last_updated: Date;
    };

    // Subscription information
    subscription: {
        plan: SubscriptionPlan;
        status: SubscriptionStatus;
        started_at: Date;
        expires_at: Date | null;
        auto_renew: boolean;
    };

    // Usage statistics
    usage_stats: {
        total_api_calls: number;
        total_agents_created: number;
        total_conversations: number;
        last_activity: Date;
    };

    // Account metadata
    created_at: Date;
    updated_at: Date;
    is_verified: boolean;
    timezone: string;
    preferred_language: string;
}

/**
 * Credit transaction record
 */
export interface CreditTransaction {
    id: string;
    user_uid: string;
    type: CreditTransactionType;
    amount: number;          // Positive for credits added, negative for usage
    balance_after: number;   // Credit balance after this transaction
    description: string;
    metadata?: {
        api_endpoint?: string;
        request_id?: string;
        agent_id?: string;
        subscription_id?: string;
        payment_id?: string;
    };
    created_at: Date;
}

/**
 * Credit package definitions
 */
export interface CreditPackage {
    id: string;
    name: string;
    credits: number;
    price: number;          // In cents (USD)
    currency: string;
    bonus_credits?: number; // Extra credits for promotions
    is_popular?: boolean;
    description: string;
}

/**
 * API usage cost configuration
 */
export interface ApiCost {
    endpoint: string;
    cost_per_request: number;
    cost_per_token?: number;  // For LLM APIs
    description: string;
}

/**
 * User credit summary for UI display
 */
export interface UserCreditSummary {
    available_credits: number;
    subscription_plan: SubscriptionPlan;
    subscription_status: SubscriptionStatus;
    next_billing_date?: Date;
    recent_usage: number;     // Credits used in last 30 days
    estimated_days_remaining?: number;
}

/**
 * Credit top-up request
 */
export interface CreditTopUpRequest {
    user_uid: string;
    package_id: string;
    payment_method?: string;
    promotional_code?: string;
}

/**
 * Default credit packages
 */
export const DEFAULT_CREDIT_PACKAGES: CreditPackage[] = [
    {
        id: 'starter-100',
        name: 'Starter Pack',
        credits: 100,
        price: 999,  // $9.99
        currency: 'USD',
        description: 'Perfect for trying out Robota APIs'
    },
    {
        id: 'popular-500',
        name: 'Popular Pack',
        credits: 500,
        price: 3999, // $39.99
        currency: 'USD',
        bonus_credits: 50,
        is_popular: true,
        description: 'Best value for regular users'
    },
    {
        id: 'pro-1000',
        name: 'Pro Pack',
        credits: 1000,
        price: 6999, // $69.99
        currency: 'USD',
        bonus_credits: 150,
        description: 'For power users and small teams'
    },
    {
        id: 'enterprise-5000',
        name: 'Enterprise Pack',
        credits: 5000,
        price: 29999, // $299.99
        currency: 'USD',
        bonus_credits: 1000,
        description: 'For large teams and enterprise use'
    }
];

/**
 * Default API costs
 */
export const DEFAULT_API_COSTS: ApiCost[] = [
    {
        endpoint: '/api/v1/agents/create',
        cost_per_request: 5,
        description: 'Agent creation'
    },
    {
        endpoint: '/api/v1/agents/run',
        cost_per_request: 2,
        description: 'Agent execution'
    },
    {
        endpoint: '/api/v1/tools/execute',
        cost_per_request: 1,
        description: 'Tool execution'
    }
];

/**
 * Free tier limitations
 */
export const FREE_TIER_LIMITS = {
    initial_credits: 50,
    max_agents: 3,
    max_conversations_per_day: 10,
    max_api_calls_per_hour: 20
}; 