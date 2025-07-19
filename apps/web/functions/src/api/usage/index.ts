import { Router } from 'express';
import { authenticateToken } from '../middleware/auth';
import { db } from '../../lib/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';

const router = Router();

interface UsageRecord {
    userId: string;
    provider: string;
    model: string;
    operation: 'agent_run' | 'tool_execute' | 'stream';
    tokensUsed: number;
    cost: number;
    timestamp: Date;
    sessionId?: string;
    duration: number;
    success: boolean;
    errorType?: string;
    metadata?: {
        toolsUsed?: string[];
        messageCount?: number;
        responseLength?: number;
        userAgent?: string;
        ipAddress?: string;
    };
}

interface UsageStats {
    totalRequests: number;
    totalTokens: number;
    totalCost: number;
    successRate: number;
    averageResponseTime: number;
    topProviders: Array<{ provider: string; usage: number; percentage: number }>;
    topModels: Array<{ model: string; usage: number; percentage: number }>;
    dailyUsage: Array<{ date: string; requests: number; tokens: number; cost: number }>;
    errorBreakdown: Array<{ type: string; count: number; percentage: number }>;
}

interface RateLimitInfo {
    userId: string;
    provider: string;
    currentHour: number;
    dailyUsage: number;
    monthlyUsage: number;
    lastRequest: Date;
    limits: {
        hourly: number;
        daily: number;
        monthly: number;
    };
}

/**
 * POST /api/v1/usage/track
 * Track AI provider usage
 */
router.post('/track', authenticateToken, async (req, res): Promise<void> => {
    try {
        const userId = req.user?.uid;
        if (!userId) {
            res.status(401).json({ error: 'User not authenticated' });
            return;
        }

        const {
            provider,
            model,
            operation,
            tokensUsed,
            duration,
            success,
            errorType,
            metadata
        } = req.body;

        // Validate required fields
        if (!provider || !model || !operation || tokensUsed === undefined) {
            res.status(400).json({
                error: 'Missing required fields: provider, model, operation, tokensUsed'
            });
            return;
        }

        // Calculate cost based on provider and model
        const cost = calculateUsageCost(provider, model, tokensUsed, operation);

        // Create usage record
        const usageRecord: UsageRecord = {
            userId,
            provider,
            model,
            operation,
            tokensUsed: Number(tokensUsed),
            cost,
            timestamp: new Date(),
            sessionId: metadata?.sessionId,
            duration: Number(duration) || 0,
            success: Boolean(success),
            errorType,
            metadata: {
                toolsUsed: metadata?.toolsUsed || [],
                messageCount: metadata?.messageCount || 1,
                responseLength: metadata?.responseLength || 0,
                userAgent: req.headers['user-agent'],
                ipAddress: req.ip
            }
        };

        // Store in Firestore
        const batch = db.batch();

        // Add to usage collection
        const usageRef = db.collection('usage').doc();
        batch.set(usageRef, usageRecord);

        // Update user daily stats
        const today = new Date().toISOString().split('T')[0];
        const dailyStatsRef = db
            .collection('userStats')
            .doc(userId)
            .collection('daily')
            .doc(today);

        batch.set(dailyStatsRef, {
            requests: FieldValue.increment(1),
            tokens: FieldValue.increment(tokensUsed),
            cost: FieldValue.increment(cost),
            lastUpdate: new Date()
        }, { merge: true });

        // Update provider stats
        const providerStatsRef = db
            .collection('userStats')
            .doc(userId)
            .collection('providers')
            .doc(provider);

        batch.set(providerStatsRef, {
            requests: FieldValue.increment(1),
            tokens: FieldValue.increment(tokensUsed),
            cost: FieldValue.increment(cost),
            lastUsed: new Date(),
            models: {
                [model]: {
                    requests: FieldValue.increment(1),
                    tokens: FieldValue.increment(tokensUsed),
                    cost: FieldValue.increment(cost)
                }
            }
        }, { merge: true });

        await batch.commit();

        res.json({
            success: true,
            usageId: usageRef.id,
            cost,
            tokensUsed
        });

    } catch (error) {
        console.error('Usage tracking error:', error);
        res.status(500).json({
            error: 'Failed to track usage',
            details: error instanceof Error ? error.message : 'Unknown error'
        });
    }
});

/**
 * GET /api/v1/usage/stats
 * Get comprehensive usage statistics
 */
router.get('/stats', authenticateToken, async (req, res): Promise<void> => {
    try {
        const userId = req.user?.uid;
        if (!userId) {
            res.status(401).json({ error: 'User not authenticated' });
            return;
        }

        const { period = '7d', provider, model } = req.query;

        // Calculate date range
        const endDate = new Date();
        const startDate = new Date();

        switch (period) {
            case '24h':
                startDate.setHours(startDate.getHours() - 24);
                break;
            case '7d':
                startDate.setDate(startDate.getDate() - 7);
                break;
            case '30d':
                startDate.setDate(startDate.getDate() - 30);
                break;
            case '90d':
                startDate.setDate(startDate.getDate() - 90);
                break;
            default:
                startDate.setDate(startDate.getDate() - 7);
        }

        // Build query
        let query = db.collection('usage')
            .where('userId', '==', userId)
            .where('timestamp', '>=', startDate)
            .where('timestamp', '<=', endDate);

        if (provider) {
            query = query.where('provider', '==', provider);
        }

        if (model) {
            query = query.where('model', '==', model);
        }

        const snapshot = await query.get();
        const records = snapshot.docs.map((doc: any) => doc.data() as UsageRecord);

        // Calculate statistics
        const stats = calculateUsageStats(records);

        res.json({
            period,
            startDate: startDate.toISOString(),
            endDate: endDate.toISOString(),
            totalRecords: records.length,
            stats
        });

    } catch (error) {
        console.error('Usage stats error:', error);
        res.status(500).json({
            error: 'Failed to get usage statistics',
            details: error instanceof Error ? error.message : 'Unknown error'
        });
    }
});

/**
 * GET /api/v1/usage/limits
 * Get current rate limits and usage
 */
router.get('/limits', authenticateToken, async (req, res): Promise<void> => {
    try {
        const userId = req.user?.uid;
        if (!userId) {
            res.status(401).json({ error: 'User not authenticated' });
            return;
        }

        const rateLimits = await getRateLimitInfo(userId);

        res.json({
            userId,
            limits: rateLimits,
            recommendations: generateUsageRecommendations(rateLimits)
        });

    } catch (error) {
        console.error('Rate limits error:', error);
        res.status(500).json({
            error: 'Failed to get rate limits',
            details: error instanceof Error ? error.message : 'Unknown error'
        });
    }
});

/**
 * GET /api/v1/usage/export
 * Export usage data
 */
router.get('/export', authenticateToken, async (req, res): Promise<void> => {
    try {
        const userId = req.user?.uid;
        if (!userId) {
            res.status(401).json({ error: 'User not authenticated' });
            return;
        }

        const { format = 'json', startDate, endDate } = req.query;

        let query = db.collection('usage').where('userId', '==', userId);

        if (startDate) {
            query = query.where('timestamp', '>=', new Date(startDate as string));
        }

        if (endDate) {
            query = query.where('timestamp', '<=', new Date(endDate as string));
        }

        const snapshot = await query.orderBy('timestamp', 'desc').limit(10000).get();
        const records = snapshot.docs.map((doc: any) => ({ id: doc.id, ...doc.data() }));

        if (format === 'csv') {
            const csv = convertToCSV(records);
            res.setHeader('Content-Type', 'text/csv');
            res.setHeader('Content-Disposition', 'attachment; filename=usage-export.csv');
            res.send(csv);
        } else {
            res.json({
                exportDate: new Date().toISOString(),
                totalRecords: records.length,
                data: records
            });
        }

    } catch (error) {
        console.error('Usage export error:', error);
        res.status(500).json({
            error: 'Failed to export usage data',
            details: error instanceof Error ? error.message : 'Unknown error'
        });
    }
});

/**
 * POST /api/v1/usage/check-limits
 * Check if user can make a request (rate limiting)
 */
router.post('/check-limits', authenticateToken, async (req, res): Promise<void> => {
    try {
        const userId = req.user?.uid;
        if (!userId) {
            res.status(401).json({ error: 'User not authenticated' });
            return;
        }

        const { provider, tokensRequested = 0 } = req.body;

        const canProceed = await checkRateLimit(userId, provider, tokensRequested);

        if (canProceed.allowed) {
            res.json({
                allowed: true,
                remaining: canProceed.remaining,
                resetTime: canProceed.resetTime
            });
        } else {
            res.status(429).json({
                allowed: false,
                error: 'Rate limit exceeded',
                limitType: canProceed.limitType,
                resetTime: canProceed.resetTime,
                remaining: canProceed.remaining
            });
        }

    } catch (error) {
        console.error('Rate limit check error:', error);
        res.status(500).json({
            error: 'Failed to check rate limits',
            details: error instanceof Error ? error.message : 'Unknown error'
        });
    }
});

/**
 * Calculate usage cost based on provider and model
 */
function calculateUsageCost(provider: string, model: string, tokens: number, operation: string): number {
    // Cost per 1K tokens (in USD)
    const pricing: Record<string, Record<string, { input: number; output: number }>> = {
        openai: {
            'gpt-4': { input: 0.03, output: 0.06 },
            'gpt-4-turbo': { input: 0.01, output: 0.03 },
            'gpt-3.5-turbo': { input: 0.001, output: 0.002 }
        },
        anthropic: {
            'claude-3-opus': { input: 0.015, output: 0.075 },
            'claude-3-sonnet': { input: 0.003, output: 0.015 },
            'claude-3-haiku': { input: 0.00025, output: 0.00125 }
        },
        google: {
            'gemini-pro': { input: 0.0005, output: 0.0015 },
            'gemini-pro-vision': { input: 0.0005, output: 0.0015 }
        }
    };

    const modelPricing = pricing[provider]?.[model];
    if (!modelPricing) {
        return 0; // Unknown model, no cost
    }

    // Assume 50/50 split for input/output tokens for simplicity
    const inputTokens = tokens * 0.5;
    const outputTokens = tokens * 0.5;

    return ((inputTokens * modelPricing.input) + (outputTokens * modelPricing.output)) / 1000;
}

/**
 * Calculate comprehensive usage statistics
 */
function calculateUsageStats(records: UsageRecord[]): UsageStats {
    if (records.length === 0) {
        return {
            totalRequests: 0,
            totalTokens: 0,
            totalCost: 0,
            successRate: 0,
            averageResponseTime: 0,
            topProviders: [],
            topModels: [],
            dailyUsage: [],
            errorBreakdown: []
        };
    }

    const totalRequests = records.length;
    const totalTokens = records.reduce((sum, r) => sum + r.tokensUsed, 0);
    const totalCost = records.reduce((sum, r) => sum + r.cost, 0);
    const successfulRequests = records.filter(r => r.success).length;
    const successRate = (successfulRequests / totalRequests) * 100;
    const averageResponseTime = records.reduce((sum, r) => sum + r.duration, 0) / totalRequests;

    // Provider breakdown
    const providerCounts: Record<string, number> = {};
    records.forEach(r => {
        providerCounts[r.provider] = (providerCounts[r.provider] || 0) + 1;
    });
    const topProviders = Object.entries(providerCounts)
        .map(([provider, usage]) => ({ provider, usage, percentage: (usage / totalRequests) * 100 }))
        .sort((a, b) => b.usage - a.usage);

    // Model breakdown
    const modelCounts: Record<string, number> = {};
    records.forEach(r => {
        modelCounts[r.model] = (modelCounts[r.model] || 0) + 1;
    });
    const topModels = Object.entries(modelCounts)
        .map(([model, usage]) => ({ model, usage, percentage: (usage / totalRequests) * 100 }))
        .sort((a, b) => b.usage - a.usage);

    // Daily usage
    const dailyData: Record<string, { requests: number; tokens: number; cost: number }> = {};
    records.forEach(r => {
        const date = r.timestamp.toISOString().split('T')[0];
        if (!dailyData[date]) {
            dailyData[date] = { requests: 0, tokens: 0, cost: 0 };
        }
        dailyData[date].requests++;
        dailyData[date].tokens += r.tokensUsed;
        dailyData[date].cost += r.cost;
    });
    const dailyUsage = Object.entries(dailyData)
        .map(([date, data]) => ({ date, ...data }))
        .sort((a, b) => a.date.localeCompare(b.date));

    // Error breakdown
    const errorCounts: Record<string, number> = {};
    const errorRecords = records.filter(r => !r.success);
    errorRecords.forEach(r => {
        const errorType = r.errorType || 'unknown';
        errorCounts[errorType] = (errorCounts[errorType] || 0) + 1;
    });
    const errorBreakdown = Object.entries(errorCounts)
        .map(([type, count]) => ({ type, count, percentage: (count / errorRecords.length) * 100 }))
        .sort((a, b) => b.count - a.count);

    return {
        totalRequests,
        totalTokens,
        totalCost,
        successRate,
        averageResponseTime,
        topProviders,
        topModels,
        dailyUsage,
        errorBreakdown
    };
}

/**
 * Get rate limit information for user
 */
async function getRateLimitInfo(userId: string): Promise<RateLimitInfo[]> {
    const providers = ['openai', 'anthropic', 'google'];
    const rateLimits: RateLimitInfo[] = [];

    for (const provider of providers) {
        const today = new Date();
        const startOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate());
        const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);

        // Get daily usage
        const dailySnapshot = await db.collection('usage')
            .where('userId', '==', userId)
            .where('provider', '==', provider)
            .where('timestamp', '>=', startOfDay)
            .get();

        // Get monthly usage
        const monthlySnapshot = await db.collection('usage')
            .where('userId', '==', userId)
            .where('provider', '==', provider)
            .where('timestamp', '>=', startOfMonth)
            .get();

        const dailyUsage = dailySnapshot.docs.length;
        const monthlyUsage = monthlySnapshot.docs.length;

        // Get user tier limits (this would come from user subscription)
        const limits = {
            hourly: 100, // requests per hour
            daily: 1000, // requests per day
            monthly: 10000 // requests per month
        };

        rateLimits.push({
            userId,
            provider,
            currentHour: 0, // Would need to calculate current hour usage
            dailyUsage,
            monthlyUsage,
            lastRequest: new Date(),
            limits
        });
    }

    return rateLimits;
}

/**
 * Check if user can make a request
 */
async function checkRateLimit(userId: string, provider: string, tokensRequested: number): Promise<{
    allowed: boolean;
    remaining: number;
    resetTime: Date;
    limitType?: string;
}> {
    const rateLimitInfo = await getRateLimitInfo(userId);
    const providerLimit = rateLimitInfo.find(r => r.provider === provider);

    if (!providerLimit) {
        return { allowed: true, remaining: 1000, resetTime: new Date() };
    }

    // Check daily limit
    if (providerLimit.dailyUsage >= providerLimit.limits.daily) {
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        tomorrow.setHours(0, 0, 0, 0);

        return {
            allowed: false,
            remaining: 0,
            resetTime: tomorrow,
            limitType: 'daily'
        };
    }

    // Check monthly limit
    if (providerLimit.monthlyUsage >= providerLimit.limits.monthly) {
        const nextMonth = new Date();
        nextMonth.setMonth(nextMonth.getMonth() + 1);
        nextMonth.setDate(1);
        nextMonth.setHours(0, 0, 0, 0);

        return {
            allowed: false,
            remaining: 0,
            resetTime: nextMonth,
            limitType: 'monthly'
        };
    }

    return {
        allowed: true,
        remaining: providerLimit.limits.daily - providerLimit.dailyUsage,
        resetTime: new Date()
    };
}

/**
 * Generate usage recommendations
 */
function generateUsageRecommendations(rateLimits: RateLimitInfo[]): string[] {
    const recommendations: string[] = [];

    rateLimits.forEach(limit => {
        const dailyUsagePercent = (limit.dailyUsage / limit.limits.daily) * 100;
        const monthlyUsagePercent = (limit.monthlyUsage / limit.limits.monthly) * 100;

        if (dailyUsagePercent > 80) {
            recommendations.push(`High daily usage for ${limit.provider} (${dailyUsagePercent.toFixed(1)}%). Consider upgrading your plan.`);
        }

        if (monthlyUsagePercent > 90) {
            recommendations.push(`Monthly limit approaching for ${limit.provider} (${monthlyUsagePercent.toFixed(1)}%). Upgrade recommended.`);
        }

        if (dailyUsagePercent < 10) {
            recommendations.push(`Low usage for ${limit.provider}. Consider exploring more features.`);
        }
    });

    return recommendations;
}

/**
 * Convert records to CSV format
 */
function convertToCSV(records: any[]): string {
    if (records.length === 0) return '';

    const headers = Object.keys(records[0]);
    const csvRows = [headers.join(',')];

    records.forEach(record => {
        const values = headers.map(header => {
            const value = record[header];
            if (typeof value === 'object') {
                return JSON.stringify(value).replace(/"/g, '""');
            }
            return `"${String(value).replace(/"/g, '""')}"`;
        });
        csvRows.push(values.join(','));
    });

    return csvRows.join('\n');
}

export { router as usageRoutes }; 