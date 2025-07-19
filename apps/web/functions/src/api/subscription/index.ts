import { Router } from 'express';
import { authenticateToken } from '../middleware/auth';
import { db } from '../../lib/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';

const router = Router();

interface UserSubscription {
    id: string;
    userId: string;
    planId: string;
    status: 'active' | 'canceled' | 'past_due' | 'trial' | 'incomplete';
    createdAt: Date;
    startDate: Date;
    endDate?: Date;
    trialEnd?: Date;
    canceledAt?: Date;
    billingCycle: 'monthly' | 'yearly';
    nextBillingDate?: Date;
    amount: number;
    currency: string;
    metadata?: Record<string, any>;
}

interface PlanLimits {
    requests: { hourly: number; daily: number; monthly: number };
    tokens: { openai: number; anthropic: number; google: number; total: number };
    cost: { daily: number; monthly: number };
    features: Record<string, boolean>;
    rateLimit: { requestsPerSecond: number; burstLimit: number };
    storage: Record<string, number>;
}

// Plan configurations
const PLAN_LIMITS: Record<string, PlanLimits> = {
    free: {
        requests: { hourly: 100, daily: 200, monthly: 1000 },
        tokens: { openai: 30000, anthropic: 30000, google: 40000, total: 100000 },
        cost: { daily: 2, monthly: 10 },
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
        rateLimit: { requestsPerSecond: 2, burstLimit: 5 },
        storage: { conversationHistory: 7, analyticsRetention: 7, maxProjects: 1, maxTeamMembers: 1 }
    },
    starter: {
        requests: { hourly: 2000, daily: 5000, monthly: 50000 },
        tokens: { openai: 700000, anthropic: 700000, google: 600000, total: 2000000 },
        cost: { daily: 20, monthly: 200 },
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
        rateLimit: { requestsPerSecond: 10, burstLimit: 25 },
        storage: { conversationHistory: 30, analyticsRetention: 30, maxProjects: 5, maxTeamMembers: 3 }
    },
    pro: {
        requests: { hourly: 8000, daily: 20000, monthly: 200000 },
        tokens: { openai: 3500000, anthropic: 3500000, google: 3000000, total: 10000000 },
        cost: { daily: 100, monthly: 1000 },
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
        rateLimit: { requestsPerSecond: 25, burstLimit: 50 },
        storage: { conversationHistory: 90, analyticsRetention: 90, maxProjects: 20, maxTeamMembers: 10 }
    },
    enterprise: {
        requests: { hourly: 999999999, daily: 999999999, monthly: 999999999 },
        tokens: { openai: 999999999, anthropic: 999999999, google: 999999999, total: 999999999 },
        cost: { daily: 10000, monthly: 50000 },
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
        rateLimit: { requestsPerSecond: 100, burstLimit: 200 },
        storage: { conversationHistory: 999999999, analyticsRetention: 999999999, maxProjects: 999999999, maxTeamMembers: 999999999 }
    }
};

/**
 * GET /api/v1/subscription
 * Get user's current subscription
 */
router.get('/', authenticateToken, async (req, res): Promise<void> => {
    try {
        const userId = req.user?.uid;
        if (!userId) {
            res.status(401).json({ error: 'User not authenticated' });
            return;
        }

        // Get user subscription from Firestore
        const subscriptionDoc = await db.collection('subscriptions').doc(userId).get();

        if (!subscriptionDoc.exists) {
            // Return default free plan
            const defaultSubscription: UserSubscription = {
                id: 'free_' + userId,
                userId,
                planId: 'free',
                status: 'active',
                createdAt: new Date(),
                startDate: new Date(),
                billingCycle: 'monthly',
                amount: 0,
                currency: 'USD'
            };

            res.json({
                subscription: defaultSubscription,
                limits: PLAN_LIMITS.free
            });
            return;
        }

        const subscription = subscriptionDoc.data() as UserSubscription;
        const limits = PLAN_LIMITS[subscription.planId] || PLAN_LIMITS.free;

        res.json({
            subscription,
            limits
        });

    } catch (error) {
        console.error('Get subscription error:', error);
        res.status(500).json({
            error: 'Failed to get subscription',
            details: error instanceof Error ? error.message : 'Unknown error'
        });
    }
});

/**
 * POST /api/v1/subscription/check-limits
 * Check if user can perform an operation within their plan limits
 */
router.post('/check-limits', authenticateToken, async (req, res): Promise<void> => {
    try {
        const userId = req.user?.uid;
        if (!userId) {
            res.status(401).json({ error: 'User not authenticated' });
            return;
        }

        const { operation, provider, tokensRequested = 0 } = req.body;

        // Get user subscription
        const subscriptionDoc = await db.collection('subscriptions').doc(userId).get();
        const subscription = subscriptionDoc.exists ? subscriptionDoc.data() as UserSubscription : null;
        const planId = subscription?.planId || 'free';
        const limits = PLAN_LIMITS[planId];

        // Get current usage
        const today = new Date().toISOString().split('T')[0];
        const currentMonth = new Date().toISOString().substring(0, 7); // YYYY-MM

        const [dailyUsage, monthlyUsage] = await Promise.all([
            db.collection('userStats').doc(userId).collection('daily').doc(today).get(),
            db.collection('userStats').doc(userId).collection('monthly').doc(currentMonth).get()
        ]);

        const dailyStats = dailyUsage.exists ? dailyUsage.data() || { requests: 0, tokens: 0, cost: 0 } : { requests: 0, tokens: 0, cost: 0 };
        const monthlyStats = monthlyUsage.exists ? monthlyUsage.data() || { requests: 0, tokens: 0, cost: 0 } : { requests: 0, tokens: 0, cost: 0 };

        // Check limits
        const checks = {
            dailyRequests: dailyStats.requests < limits.requests.daily,
            monthlyRequests: monthlyStats.requests < limits.requests.monthly,
            monthlyTokens: (monthlyStats.tokens || 0) + tokensRequested <= limits.tokens.total,
            dailyCost: (dailyStats.cost || 0) < limits.cost.daily,
            monthlyCost: (monthlyStats.cost || 0) < limits.cost.monthly
        };

        const allowed = Object.values(checks).every(check => check);

        // Calculate remaining allowances
        const remaining = {
            requests: {
                daily: Math.max(0, limits.requests.daily - (dailyStats.requests || 0)),
                monthly: Math.max(0, limits.requests.monthly - (monthlyStats.requests || 0))
            },
            tokens: {
                monthly: Math.max(0, limits.tokens.total - (monthlyStats.tokens || 0))
            },
            cost: {
                daily: Math.max(0, limits.cost.daily - (dailyStats.cost || 0)),
                monthly: Math.max(0, limits.cost.monthly - (monthlyStats.cost || 0))
            }
        };

        // Determine which limit was hit
        let limitType: string | undefined;
        let resetTime: Date = new Date();

        if (!checks.dailyRequests) {
            limitType = 'daily_requests';
            resetTime = new Date();
            resetTime.setDate(resetTime.getDate() + 1);
            resetTime.setHours(0, 0, 0, 0);
        } else if (!checks.monthlyRequests) {
            limitType = 'monthly_requests';
            resetTime = new Date();
            resetTime.setMonth(resetTime.getMonth() + 1);
            resetTime.setDate(1);
            resetTime.setHours(0, 0, 0, 0);
        } else if (!checks.monthlyTokens) {
            limitType = 'monthly_tokens';
            resetTime = new Date();
            resetTime.setMonth(resetTime.getMonth() + 1);
            resetTime.setDate(1);
            resetTime.setHours(0, 0, 0, 0);
        } else if (!checks.dailyCost) {
            limitType = 'daily_cost';
            resetTime = new Date();
            resetTime.setDate(resetTime.getDate() + 1);
            resetTime.setHours(0, 0, 0, 0);
        } else if (!checks.monthlyCost) {
            limitType = 'monthly_cost';
            resetTime = new Date();
            resetTime.setMonth(resetTime.getMonth() + 1);
            resetTime.setDate(1);
            resetTime.setHours(0, 0, 0, 0);
        }

        // Suggest upgrade if needed
        let upgradeRecommendation: any = null;
        if (!allowed) {
            const suggestedPlan = planId === 'free' ? 'starter' : planId === 'starter' ? 'pro' : 'enterprise';
            upgradeRecommendation = {
                recommended: true,
                suggestedPlan,
                reason: `Your current ${planId} plan has reached its ${limitType?.replace('_', ' ')} limit.`
            };
        }

        res.json({
            allowed,
            remaining,
            resetTime,
            limitType,
            currentPlan: planId,
            upgrade: upgradeRecommendation,
            checks
        });

    } catch (error) {
        console.error('Check limits error:', error);
        res.status(500).json({
            error: 'Failed to check limits',
            details: error instanceof Error ? error.message : 'Unknown error'
        });
    }
});

/**
 * POST /api/v1/subscription/change-plan
 * Change user's subscription plan (without payment processing)
 */
router.post('/change-plan', authenticateToken, async (req, res): Promise<void> => {
    try {
        const userId = req.user?.uid;
        if (!userId) {
            res.status(401).json({ error: 'User not authenticated' });
            return;
        }

        const { planId, billingCycle = 'monthly' } = req.body;

        // Validate plan
        if (!PLAN_LIMITS[planId]) {
            res.status(400).json({ error: 'Invalid plan ID' });
            return;
        }

        // For now, only allow free plan changes (until payment integration)
        if (planId !== 'free') {
            res.status(400).json({
                error: 'Paid plan upgrades not yet available',
                message: 'Payment integration is coming soon. You will be notified when paid plans become available.'
            });
            return;
        }

        const now = new Date();
        const subscription: UserSubscription = {
            id: `${planId}_${userId}`,
            userId,
            planId,
            status: 'active',
            createdAt: now,
            startDate: now,
            billingCycle: billingCycle as 'monthly' | 'yearly',
            amount: 0, // Free plan
            currency: 'USD'
        };

        // Save to Firestore
        await db.collection('subscriptions').doc(userId).set(subscription);

        // Log plan change
        await db.collection('subscriptionEvents').add({
            userId,
            type: 'plan_changed',
            fromPlan: 'unknown',
            toPlan: planId,
            timestamp: now,
            metadata: {
                billingCycle,
                amount: 0
            }
        });

        res.json({
            success: true,
            subscription,
            limits: PLAN_LIMITS[planId],
            message: `Successfully switched to ${planId} plan`
        });

    } catch (error) {
        console.error('Change plan error:', error);
        res.status(500).json({
            error: 'Failed to change plan',
            details: error instanceof Error ? error.message : 'Unknown error'
        });
    }
});

/**
 * GET /api/v1/subscription/usage-summary
 * Get detailed usage summary for the current period
 */
router.get('/usage-summary', authenticateToken, async (req, res): Promise<void> => {
    try {
        const userId = req.user?.uid;
        if (!userId) {
            res.status(401).json({ error: 'User not authenticated' });
            return;
        }

        const { period = 'month' } = req.query;

        let startDate: Date;
        let endDate = new Date();

        if (period === 'day') {
            startDate = new Date();
            startDate.setHours(0, 0, 0, 0);
        } else if (period === 'week') {
            startDate = new Date();
            startDate.setDate(startDate.getDate() - 7);
        } else {
            // month
            startDate = new Date();
            startDate.setDate(1);
            startDate.setHours(0, 0, 0, 0);
        }

        // Get usage data
        const usageSnapshot = await db.collection('usage')
            .where('userId', '==', userId)
            .where('timestamp', '>=', startDate)
            .where('timestamp', '<=', endDate)
            .get();

        const usage = usageSnapshot.docs.map(doc => doc.data());

        // Calculate summaries
        const summary = {
            period: {
                start: startDate.toISOString(),
                end: endDate.toISOString(),
                type: period
            },
            requests: {
                total: usage.length,
                successful: usage.filter(u => u.success).length,
                failed: usage.filter(u => !u.success).length,
                byProvider: {} as Record<string, number>
            },
            tokens: {
                total: usage.reduce((sum, u) => sum + (u.tokensUsed || 0), 0),
                byProvider: {} as Record<string, number>,
                byModel: {} as Record<string, number>
            },
            cost: {
                total: usage.reduce((sum, u) => sum + (u.cost || 0), 0),
                byProvider: {} as Record<string, number>,
                estimatedMonthly: 0
            },
            features: {
                playgroundSessions: usage.filter(u => u.metadata?.source === 'playground').length,
                analyticsViews: 0, // Would need separate tracking
                apiKeysCreated: 0, // Would need separate tracking
                projectsCreated: 0 // Would need separate tracking
            }
        };

        // Calculate by provider
        usage.forEach(u => {
            summary.requests.byProvider[u.provider] = (summary.requests.byProvider[u.provider] || 0) + 1;
            summary.tokens.byProvider[u.provider] = (summary.tokens.byProvider[u.provider] || 0) + (u.tokensUsed || 0);
            summary.cost.byProvider[u.provider] = (summary.cost.byProvider[u.provider] || 0) + (u.cost || 0);

            if (u.model) {
                summary.tokens.byModel[u.model] = (summary.tokens.byModel[u.model] || 0) + (u.tokensUsed || 0);
            }
        });

        // Estimate monthly cost
        if (period === 'day') {
            summary.cost.estimatedMonthly = summary.cost.total * 30;
        } else if (period === 'week') {
            summary.cost.estimatedMonthly = summary.cost.total * 4.33;
        } else {
            summary.cost.estimatedMonthly = summary.cost.total;
        }

        res.json(summary);

    } catch (error) {
        console.error('Usage summary error:', error);
        res.status(500).json({
            error: 'Failed to get usage summary',
            details: error instanceof Error ? error.message : 'Unknown error'
        });
    }
});

/**
 * GET /api/v1/subscription/plans
 * Get available subscription plans
 */
router.get('/plans', async (req, res): Promise<void> => {
    try {
        const plans = Object.entries(PLAN_LIMITS).map(([planId, limits]) => ({
            id: planId,
            name: planId,
            displayName: planId.charAt(0).toUpperCase() + planId.slice(1),
            limits,
            pricing: {
                monthly: planId === 'free' ? 0 : planId === 'starter' ? 29 : planId === 'pro' ? 99 : 499,
                yearly: planId === 'free' ? 0 : planId === 'starter' ? 290 : planId === 'pro' ? 990 : 4990
            }
        }));

        res.json({ plans });
    } catch (error) {
        console.error('Get plans error:', error);
        res.status(500).json({
            error: 'Failed to get plans',
            details: error instanceof Error ? error.message : 'Unknown error'
        });
    }
});

export { router as subscriptionRoutes }; 