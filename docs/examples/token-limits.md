# Token and Request Limits

This example demonstrates how to monitor token usage, implement rate limiting, and manage costs effectively when using AI providers.

## Overview

The token and request limits example shows how to:
- Monitor token usage and API costs in real-time
- Implement request rate limiting and throttling
- Track usage statistics and analytics
- Set up cost controls and budget alerts
- Optimize token efficiency and reduce costs

## Source Code

**Locations**: 
- `apps/examples/01-basic/06-token-and-request-limits.ts` - Comprehensive limits management
- `apps/examples/01-basic/06-token-and-request-limits-simple.ts` - Basic usage tracking

## Key Concepts

### 1. Basic Usage Tracking
```typescript
import { Robota, OpenAIProvider } from '@robota-sdk/core';

// Create Robota with usage tracking enabled
const robota = new Robota({
    aiProviders: { 'openai': openaiProvider },
    currentModel: 'gpt-3.5-turbo',
    trackUsage: true,                    // Enable usage tracking
    maxTokensPerRequest: 1000,           // Limit per request
    maxTokensPerHour: 10000,            // Hourly limit
    maxRequestsPerMinute: 60,           // Rate limiting
    systemPrompt: 'You are a helpful assistant with usage monitoring.'
});

// Send request and check usage
const response = await robota.run('Explain quantum computing');
const usage = robota.getUsageStats();

console.log('Usage Statistics:', {
    totalTokens: usage.totalTokens,
    totalRequests: usage.totalRequests,
    estimatedCost: usage.estimatedCost
});
```

### 2. Advanced Rate Limiting
```typescript
class TokenBudgetManager {
    private dailyLimit: number;
    private hourlyLimit: number;
    private currentDailyUsage: number = 0;
    private currentHourlyUsage: number = 0;
    private lastHourReset: Date = new Date();
    private lastDayReset: Date = new Date();
    
    constructor(dailyLimit: number = 100000, hourlyLimit: number = 10000) {
        this.dailyLimit = dailyLimit;
        this.hourlyLimit = hourlyLimit;
    }
    
    canMakeRequest(estimatedTokens: number): boolean {
        this.resetCountersIfNeeded();
        
        // Check if request would exceed limits
        if (this.currentHourlyUsage + estimatedTokens > this.hourlyLimit) {
            console.warn('Hourly token limit would be exceeded');
            return false;
        }
        
        if (this.currentDailyUsage + estimatedTokens > this.dailyLimit) {
            console.warn('Daily token limit would be exceeded');
            return false;
        }
        
        return true;
    }
    
    recordUsage(actualTokens: number) {
        this.resetCountersIfNeeded();
        this.currentHourlyUsage += actualTokens;
        this.currentDailyUsage += actualTokens;
    }
    
    private resetCountersIfNeeded() {
        const now = new Date();
        
        // Reset hourly counter
        if (now.getTime() - this.lastHourReset.getTime() >= 60 * 60 * 1000) {
            this.currentHourlyUsage = 0;
            this.lastHourReset = now;
        }
        
        // Reset daily counter
        if (now.getTime() - this.lastDayReset.getTime() >= 24 * 60 * 60 * 1000) {
            this.currentDailyUsage = 0;
            this.lastDayReset = now;
        }
    }
    
    getUsageStats() {
        this.resetCountersIfNeeded();
        
        return {
            hourly: {
                used: this.currentHourlyUsage,
                limit: this.hourlyLimit,
                remaining: this.hourlyLimit - this.currentHourlyUsage,
                percentage: (this.currentHourlyUsage / this.hourlyLimit) * 100
            },
            daily: {
                used: this.currentDailyUsage,
                limit: this.dailyLimit,
                remaining: this.dailyLimit - this.currentDailyUsage,
                percentage: (this.currentDailyUsage / this.dailyLimit) * 100
            }
        };
    }
}
```

### 3. Cost Calculation and Monitoring
```typescript
class CostTracker {
    private static readonly PRICING = {
        'openai': {
            'gpt-3.5-turbo': { input: 0.001, output: 0.002 },
            'gpt-4': { input: 0.03, output: 0.06 },
            'gpt-4-turbo': { input: 0.01, output: 0.03 },
            'gpt-4o': { input: 0.005, output: 0.015 },
            'gpt-4o-mini': { input: 0.00015, output: 0.0006 }
        },
        'anthropic': {
            'claude-3-5-sonnet-20241022': { input: 0.003, output: 0.015 },
            'claude-3-5-haiku-20241022': { input: 0.0008, output: 0.004 }
        },
        'google': {
            'gemini-1.5-pro': { input: 0.0035, output: 0.0105 },
            'gemini-1.5-flash': { input: 0.00035, output: 0.00105 }
        }
    };
    
    private usageHistory: Array<{
        timestamp: Date;
        provider: string;
        model: string;
        inputTokens: number;
        outputTokens: number;
        cost: number;
    }> = [];
    
    calculateCost(provider: string, model: string, inputTokens: number, outputTokens: number): number {
        const pricing = CostTracker.PRICING[provider]?.[model];
        if (!pricing) {
            console.warn(`No pricing data for ${provider}/${model}`);
            return 0;
        }
        
        const inputCost = (inputTokens / 1000) * pricing.input;
        const outputCost = (outputTokens / 1000) * pricing.output;
        
        return inputCost + outputCost;
    }
    
    recordUsage(provider: string, model: string, inputTokens: number, outputTokens: number) {
        const cost = this.calculateCost(provider, model, inputTokens, outputTokens);
        
        this.usageHistory.push({
            timestamp: new Date(),
            provider,
            model,
            inputTokens,
            outputTokens,
            cost
        });
        
        // Keep only last 1000 entries
        if (this.usageHistory.length > 1000) {
            this.usageHistory = this.usageHistory.slice(-1000);
        }
    }
    
    getTotalCost(timeframe?: 'hour' | 'day' | 'week' | 'month'): number {
        let cutoff = new Date(0); // Beginning of time
        
        if (timeframe) {
            const now = new Date();
            switch (timeframe) {
                case 'hour':
                    cutoff = new Date(now.getTime() - 60 * 60 * 1000);
                    break;
                case 'day':
                    cutoff = new Date(now.getTime() - 24 * 60 * 60 * 1000);
                    break;
                case 'week':
                    cutoff = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
                    break;
                case 'month':
                    cutoff = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
                    break;
            }
        }
        
        return this.usageHistory
            .filter(entry => entry.timestamp >= cutoff)
            .reduce((sum, entry) => sum + entry.cost, 0);
    }
    
    getCostBreakdown(timeframe?: 'hour' | 'day' | 'week' | 'month') {
        let cutoff = new Date(0);
        
        if (timeframe) {
            const now = new Date();
            switch (timeframe) {
                case 'hour':
                    cutoff = new Date(now.getTime() - 60 * 60 * 1000);
                    break;
                case 'day':
                    cutoff = new Date(now.getTime() - 24 * 60 * 60 * 1000);
                    break;
                case 'week':
                    cutoff = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
                    break;
                case 'month':
                    cutoff = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
                    break;
            }
        }
        
        const relevantEntries = this.usageHistory.filter(entry => entry.timestamp >= cutoff);
        const breakdown = {};
        
        for (const entry of relevantEntries) {
            const key = `${entry.provider}/${entry.model}`;
            if (!breakdown[key]) {
                breakdown[key] = {
                    requests: 0,
                    inputTokens: 0,
                    outputTokens: 0,
                    totalCost: 0
                };
            }
            
            breakdown[key].requests++;
            breakdown[key].inputTokens += entry.inputTokens;
            breakdown[key].outputTokens += entry.outputTokens;
            breakdown[key].totalCost += entry.cost;
        }
        
        return breakdown;
    }
    
    getUsageStats(timeframe?: 'hour' | 'day' | 'week' | 'month') {
        const breakdown = this.getCostBreakdown(timeframe);
        const totalCost = this.getTotalCost(timeframe);
        
        return {
            totalCost: Number(totalCost.toFixed(4)),
            breakdown,
            timeframe: timeframe || 'all-time',
            entryCount: this.usageHistory.length
        };
    }
}
```

## Running the Examples

### Comprehensive Limits Example

1. **Set up environment**:
   ```env
   OPENAI_API_KEY=your_openai_key_here
   ```

2. **Run the comprehensive example**:
   ```bash
   cd apps/examples
   bun run 01-basic/06-token-and-request-limits.ts
   ```

### Simple Usage Tracking

1. **Run the simple example**:
   ```bash
   cd apps/examples
   bun run 01-basic/06-token-and-request-limits-simple.ts
   ```

## Expected Output

```
===== Token and Request Limits Management =====

----- Basic Usage Tracking -----
Request 1: "What is TypeScript?"
Tokens used: 156 (input: 15, output: 141)
Estimated cost: $0.0003

Request 2: "Explain its main benefits"
Tokens used: 198 (input: 21, output: 177)
Estimated cost: $0.0004

Total usage so far:
- Total tokens: 354
- Total requests: 2
- Total cost: $0.0007

----- Rate Limiting Test -----
✓ Request within hourly limit (354/10000 tokens)
✓ Request within daily limit (354/100000 tokens)

----- Cost Breakdown -----
Usage statistics (last hour):
{
  "totalCost": 0.0007,
  "breakdown": {
    "openai/gpt-3.5-turbo": {
      "requests": 2,
      "inputTokens": 36,
      "outputTokens": 318,
      "totalCost": 0.0007
    }
  },
  "timeframe": "hour",
  "entryCount": 2
}

----- Budget Alert Test -----
⚠️  Daily budget (50%) warning: $0.0007 of $0.001 used
```

## Advanced Usage Management

### 1. Request Queue with Rate Limiting
```typescript
class RateLimitedQueue {
    private queue: Array<{
        prompt: string;
        resolve: (value: string) => void;
        reject: (error: Error) => void;
        priority: number;
        estimatedTokens: number;
    }> = [];
    
    private processing: boolean = false;
    private requestsThisMinute: number = 0;
    private lastMinuteReset: Date = new Date();
    private maxRequestsPerMinute: number;
    private budgetManager: TokenBudgetManager;
    
    constructor(maxRequestsPerMinute: number, budgetManager: TokenBudgetManager) {
        this.maxRequestsPerMinute = maxRequestsPerMinute;
        this.budgetManager = budgetManager;
    }
    
    async enqueue(robota: Robota, prompt: string, priority: number = 1): Promise<string> {
        return new Promise((resolve, reject) => {
            const estimatedTokens = this.estimateTokens(prompt);
            
            // Check budget before queueing
            if (!this.budgetManager.canMakeRequest(estimatedTokens)) {
                reject(new Error('Request would exceed budget limits'));
                return;
            }
            
            this.queue.push({
                prompt,
                resolve,
                reject,
                priority,
                estimatedTokens
            });
            
            // Sort by priority (higher number = higher priority)
            this.queue.sort((a, b) => b.priority - a.priority);
            
            if (!this.processing) {
                this.processQueue(robota);
            }
        });
    }
    
    private async processQueue(robota: Robota) {
        this.processing = true;
        
        while (this.queue.length > 0) {
            // Check rate limits
            this.resetMinuteCounterIfNeeded();
            
            if (this.requestsThisMinute >= this.maxRequestsPerMinute) {
                console.log('Rate limit reached, waiting...');
                await this.waitUntilNextMinute();
                continue;
            }
            
            const request = this.queue.shift()!;
            
            try {
                // Check budget again before processing
                if (!this.budgetManager.canMakeRequest(request.estimatedTokens)) {
                    request.reject(new Error('Budget limit exceeded'));
                    continue;
                }
                
                console.log(`Processing request: "${request.prompt.substring(0, 50)}..."`);
                
                const response = await robota.run(request.prompt);
                
                // Record actual usage
                const actualTokens = this.estimateTokens(request.prompt + response);
                this.budgetManager.recordUsage(actualTokens);
                
                this.requestsThisMinute++;
                request.resolve(response);
                
            } catch (error) {
                request.reject(error);
            }
            
            // Small delay between requests
            await new Promise(resolve => setTimeout(resolve, 100));
        }
        
        this.processing = false;
    }
    
    private estimateTokens(text: string): number {
        // Rough estimation: 1 token ≈ 4 characters
        return Math.ceil(text.length / 4);
    }
    
    private resetMinuteCounterIfNeeded() {
        const now = new Date();
        if (now.getTime() - this.lastMinuteReset.getTime() >= 60 * 1000) {
            this.requestsThisMinute = 0;
            this.lastMinuteReset = now;
        }
    }
    
    private async waitUntilNextMinute() {
        const now = new Date();
        const nextMinute = new Date(now.getTime() + (60 * 1000));
        nextMinute.setSeconds(0, 0);
        
        const waitTime = nextMinute.getTime() - now.getTime();
        
        console.log(`Waiting ${waitTime}ms until next minute...`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
        
        this.requestsThisMinute = 0;
        this.lastMinuteReset = new Date();
    }
    
    getQueueStats() {
        return {
            queueLength: this.queue.length,
            requestsThisMinute: this.requestsThisMinute,
            maxRequestsPerMinute: this.maxRequestsPerMinute,
            processing: this.processing
        };
    }
}
```

### 2. Budget Alerts and Controls
```typescript
class BudgetAlertSystem {
    private dailyBudget: number;
    private monthlyBudget: number;
    private costTracker: CostTracker;
    private alertThresholds: number[] = [0.5, 0.75, 0.9, 0.95];
    private alertsSent: Set<string> = new Set();
    
    constructor(dailyBudget: number, monthlyBudget: number, costTracker: CostTracker) {
        this.dailyBudget = dailyBudget;
        this.monthlyBudget = monthlyBudget;
        this.costTracker = costTracker;
    }
    
    checkBudgetStatus(): BudgetStatus {
        const dailyCost = this.costTracker.getTotalCost('day');
        const monthlyCost = this.costTracker.getTotalCost('month');
        
        const dailyPercentage = (dailyCost / this.dailyBudget) * 100;
        const monthlyPercentage = (monthlyCost / this.monthlyBudget) * 100;
        
        // Check for alerts
        this.checkAndSendAlerts('daily', dailyPercentage, dailyCost);
        this.checkAndSendAlerts('monthly', monthlyPercentage, monthlyCost);
        
        return {
            daily: {
                used: dailyCost,
                budget: this.dailyBudget,
                percentage: dailyPercentage,
                status: this.getStatus(dailyPercentage)
            },
            monthly: {
                used: monthlyCost,
                budget: this.monthlyBudget,
                percentage: monthlyPercentage,
                status: this.getStatus(monthlyPercentage)
            }
        };
    }
    
    private checkAndSendAlerts(period: 'daily' | 'monthly', percentage: number, cost: number) {
        for (const threshold of this.alertThresholds) {
            const alertKey = `${period}-${threshold}`;
            
            if (percentage >= threshold * 100 && !this.alertsSent.has(alertKey)) {
                this.sendAlert(period, threshold, percentage, cost);
                this.alertsSent.add(alertKey);
            }
        }
    }
    
    private sendAlert(period: string, threshold: number, percentage: number, cost: number) {
        const budget = period === 'daily' ? this.dailyBudget : this.monthlyBudget;
        
        console.warn(`🚨 Budget Alert: ${period} spending at ${percentage.toFixed(1)}% of budget`);
        console.warn(`   Cost: $${cost.toFixed(4)} / $${budget.toFixed(4)}`);
        
        if (percentage >= 95) {
            console.error('⛔ CRITICAL: Budget almost exhausted! Consider pausing requests.');
        } else if (percentage >= 90) {
            console.warn('⚠️  WARNING: Budget 90% used. Monitor usage carefully.');
        }
    }
    
    private getStatus(percentage: number): 'safe' | 'warning' | 'critical' | 'exceeded' {
        if (percentage >= 100) return 'exceeded';
        if (percentage >= 90) return 'critical';
        if (percentage >= 75) return 'warning';
        return 'safe';
    }
    
    shouldBlockRequest(): boolean {
        const status = this.checkBudgetStatus();
        return status.daily.status === 'exceeded' || status.monthly.status === 'exceeded';
    }
    
    resetDailyAlerts() {
        // Reset daily alerts (call this daily)
        const dailyAlerts = Array.from(this.alertsSent).filter(key => key.startsWith('daily-'));
        dailyAlerts.forEach(key => this.alertsSent.delete(key));
    }
    
    resetMonthlyAlerts() {
        // Reset monthly alerts (call this monthly)
        const monthlyAlerts = Array.from(this.alertsSent).filter(key => key.startsWith('monthly-'));
        monthlyAlerts.forEach(key => this.alertsSent.delete(key));
    }
}

interface BudgetStatus {
    daily: {
        used: number;
        budget: number;
        percentage: number;
        status: 'safe' | 'warning' | 'critical' | 'exceeded';
    };
    monthly: {
        used: number;
        budget: number;
        percentage: number;
        status: 'safe' | 'warning' | 'critical' | 'exceeded';
    };
}
```

### 3. Token Optimization Strategies
```typescript
class TokenOptimizer {
    static optimizePrompt(prompt: string, maxTokens: number): string {
        // Estimate current token count
        const estimatedTokens = Math.ceil(prompt.length / 4);
        
        if (estimatedTokens <= maxTokens) {
            return prompt;
        }
        
        // Strategy 1: Remove extra whitespace and formatting
        let optimized = prompt
            .replace(/\s+/g, ' ')           // Multiple spaces to single
            .replace(/\n\s*\n/g, '\n')      // Multiple newlines to single
            .trim();
        
        // Strategy 2: Abbreviate common phrases
        const abbreviations = {
            'for example': 'e.g.',
            'that is': 'i.e.',
            'and so on': 'etc.',
            'please': 'pls',
            'because': 'bc',
            'with regard to': 're:',
            'in order to': 'to'
        };
        
        for (const [full, abbrev] of Object.entries(abbreviations)) {
            optimized = optimized.replace(new RegExp(full, 'gi'), abbrev);
        }
        
        // Strategy 3: If still too long, truncate intelligently
        const newEstimate = Math.ceil(optimized.length / 4);
        if (newEstimate > maxTokens) {
            const targetLength = maxTokens * 4 * 0.9; // 90% of limit for safety
            
            // Try to truncate at sentence boundaries
            const sentences = optimized.split(/[.!?]+/);
            let truncated = '';
            
            for (const sentence of sentences) {
                if ((truncated + sentence).length <= targetLength) {
                    truncated += sentence + '.';
                } else {
                    break;
                }
            }
            
            optimized = truncated || optimized.substring(0, targetLength);
        }
        
        return optimized;
    }
    
    static splitLongPrompt(prompt: string, maxTokensPerChunk: number): string[] {
        const chunks: string[] = [];
        const sentences = prompt.split(/[.!?]+/);
        let currentChunk = '';
        
        for (const sentence of sentences) {
            const potentialChunk = currentChunk + sentence + '.';
            const estimatedTokens = Math.ceil(potentialChunk.length / 4);
            
            if (estimatedTokens <= maxTokensPerChunk) {
                currentChunk = potentialChunk;
            } else {
                if (currentChunk) {
                    chunks.push(currentChunk.trim());
                    currentChunk = sentence + '.';
                } else {
                    // Single sentence is too long, force split
                    chunks.push(sentence.substring(0, maxTokensPerChunk * 4));
                }
            }
        }
        
        if (currentChunk) {
            chunks.push(currentChunk.trim());
        }
        
        return chunks;
    }
    
    static estimateResponseTokens(prompt: string): number {
        // Heuristic: response is typically 1-3x the prompt length
        const promptTokens = Math.ceil(prompt.length / 4);
        
        // Adjust based on prompt type
        if (prompt.toLowerCase().includes('summarize') || prompt.toLowerCase().includes('brief')) {
            return promptTokens * 0.5; // Summaries are typically shorter
        } else if (prompt.toLowerCase().includes('explain') || prompt.toLowerCase().includes('detail')) {
            return promptTokens * 2; // Explanations are typically longer
        } else if (prompt.toLowerCase().includes('list') || prompt.toLowerCase().includes('enumerate')) {
            return promptTokens * 1.5; // Lists are moderately long
        }
        
        return promptTokens; // Default 1:1 ratio
    }
}
```

## Performance Analytics

### 1. Usage Analytics Dashboard
```typescript
class UsageAnalytics {
    private costTracker: CostTracker;
    
    constructor(costTracker: CostTracker) {
        this.costTracker = costTracker;
    }
    
    generateDashboard(): UsageDashboard {
        const hourlyStats = this.costTracker.getUsageStats('hour');
        const dailyStats = this.costTracker.getUsageStats('day');
        const weeklyStats = this.costTracker.getUsageStats('week');
        const monthlyStats = this.costTracker.getUsageStats('month');
        
        return {
            summary: {
                lastHour: hourlyStats,
                lastDay: dailyStats,
                lastWeek: weeklyStats,
                lastMonth: monthlyStats
            },
            trends: this.calculateTrends(),
            topModels: this.getTopModels(),
            costEfficiency: this.analyzeCostEfficiency(),
            recommendations: this.generateRecommendations()
        };
    }
    
    private calculateTrends() {
        // Calculate usage trends over time
        const dailyStats = this.costTracker.getUsageStats('day');
        const weeklyStats = this.costTracker.getUsageStats('week');
        
        const dailyAvg = dailyStats.totalCost;
        const weeklyAvg = weeklyStats.totalCost / 7;
        
        const trend = dailyAvg > weeklyAvg ? 'increasing' : dailyAvg < weeklyAvg ? 'decreasing' : 'stable';
        const changePercent = weeklyAvg > 0 ? ((dailyAvg - weeklyAvg) / weeklyAvg) * 100 : 0;
        
        return {
            direction: trend,
            changePercent: Number(changePercent.toFixed(1)),
            dailyAverage: Number(dailyAvg.toFixed(4)),
            weeklyAverage: Number(weeklyAvg.toFixed(4))
        };
    }
    
    private getTopModels() {
        const monthlyStats = this.costTracker.getUsageStats('month');
        
        return Object.entries(monthlyStats.breakdown)
            .sort(([,a], [,b]) => b.totalCost - a.totalCost)
            .slice(0, 5)
            .map(([model, stats]) => ({
                model,
                cost: Number(stats.totalCost.toFixed(4)),
                requests: stats.requests,
                avgCostPerRequest: Number((stats.totalCost / stats.requests).toFixed(6))
            }));
    }
    
    private analyzeCostEfficiency() {
        const monthlyStats = this.costTracker.getUsageStats('month');
        
        const efficiency = Object.entries(monthlyStats.breakdown).map(([model, stats]) => {
            const avgTokensPerRequest = (stats.inputTokens + stats.outputTokens) / stats.requests;
            const costPerToken = stats.totalCost / (stats.inputTokens + stats.outputTokens);
            
            return {
                model,
                avgTokensPerRequest: Number(avgTokensPerRequest.toFixed(1)),
                costPerToken: Number(costPerToken.toFixed(8)),
                efficiency: avgTokensPerRequest / costPerToken // Higher is better
            };
        }).sort((a, b) => b.efficiency - a.efficiency);
        
        return efficiency;
    }
    
    private generateRecommendations(): string[] {
        const recommendations: string[] = [];
        const monthlyStats = this.costTracker.getUsageStats('month');
        const trends = this.calculateTrends();
        
        // Cost trend recommendations
        if (trends.direction === 'increasing' && trends.changePercent > 20) {
            recommendations.push('Consider implementing stricter usage limits - costs increased by ' + trends.changePercent + '% recently');
        }
        
        // Model efficiency recommendations
        const topModels = this.getTopModels();
        if (topModels.length > 1) {
            const mostExpensive = topModels[0];
            const cheapestAlternative = topModels.find(m => m.cost < mostExpensive.cost);
            
            if (cheapestAlternative && mostExpensive.avgCostPerRequest > cheapestAlternative.avgCostPerRequest * 2) {
                recommendations.push(`Consider using ${cheapestAlternative.model} for some tasks - it costs ${((1 - cheapestAlternative.avgCostPerRequest / mostExpensive.avgCostPerRequest) * 100).toFixed(0)}% less per request`);
            }
        }
        
        // Usage pattern recommendations
        if (monthlyStats.totalCost > 0) {
            const breakdown = Object.values(monthlyStats.breakdown);
            const totalRequests = breakdown.reduce((sum, stats) => sum + stats.requests, 0);
            
            if (totalRequests > 1000) {
                recommendations.push('High volume usage detected - consider implementing request caching to reduce costs');
            }
        }
        
        return recommendations;
    }
}

interface UsageDashboard {
    summary: {
        lastHour: any;
        lastDay: any;
        lastWeek: any;
        lastMonth: any;
    };
    trends: {
        direction: string;
        changePercent: number;
        dailyAverage: number;
        weeklyAverage: number;
    };
    topModels: Array<{
        model: string;
        cost: number;
        requests: number;
        avgCostPerRequest: number;
    }>;
    costEfficiency: Array<{
        model: string;
        avgTokensPerRequest: number;
        costPerToken: number;
        efficiency: number;
    }>;
    recommendations: string[];
}
```

## Best Practices

### 1. Efficient Token Usage
```typescript
// Optimize prompts for token efficiency
function createEfficientPrompt(userQuery: string, context?: string): string {
    let prompt = userQuery;
    
    // Add context only if necessary and within limits
    if (context && context.length < 500) {
        prompt = `Context: ${context}\n\nQuery: ${userQuery}`;
    }
    
    // Optimize prompt structure
    return TokenOptimizer.optimizePrompt(prompt, 1000);
}

// Use streaming for long responses
async function streamingResponse(robota: Robota, prompt: string) {
    const stream = await robota.runStream(prompt);
    let fullResponse = '';
    
    for await (const chunk of stream) {
        fullResponse += chunk.content || '';
        // Process chunks as they arrive
    }
    
    return fullResponse;
}
```

### 2. Cost-Aware Model Selection
```typescript
function selectCostEffectiveModel(taskType: string, budgetConstraint: number): string {
    const modelCosts = {
        'gpt-3.5-turbo': 0.002,     // Low cost, good for simple tasks
        'gpt-4o-mini': 0.0008,      // Very low cost, good for basic tasks
        'gpt-4': 0.06,              // High cost, best quality
        'gpt-4-turbo': 0.03         // Medium cost, good balance
    };
    
    const taskModels = {
        'simple': ['gpt-4o-mini', 'gpt-3.5-turbo'],
        'complex': ['gpt-4-turbo', 'gpt-4'],
        'creative': ['gpt-4', 'gpt-4-turbo'],
        'analytical': ['gpt-4', 'gpt-4-turbo']
    };
    
    const candidates = taskModels[taskType] || ['gpt-3.5-turbo'];
    
    // Select most capable model within budget
    for (const model of candidates) {
        if (modelCosts[model] <= budgetConstraint) {
            return model;
        }
    }
    
    // Fallback to cheapest option
    return 'gpt-4o-mini';
}
```

### 3. Request Batching and Caching
```typescript
class RequestOptimizer {
    private cache: Map<string, { response: string, timestamp: number }> = new Map();
    private cacheTTL: number = 60 * 60 * 1000; // 1 hour
    
    async optimizedRequest(robota: Robota, prompt: string): Promise<string> {
        // Check cache first
        const cacheKey = this.generateCacheKey(prompt);
        const cached = this.cache.get(cacheKey);
        
        if (cached && Date.now() - cached.timestamp < this.cacheTTL) {
            console.log('Cache hit - saved tokens!');
            return cached.response;
        }
        
        // Make request if not cached
        const response = await robota.run(prompt);
        
        // Cache the response
        this.cache.set(cacheKey, {
            response,
            timestamp: Date.now()
        });
        
        // Clean old cache entries
        this.cleanCache();
        
        return response;
    }
    
    private generateCacheKey(prompt: string): string {
        // Simple hash for caching (use crypto.createHash in production)
        return Buffer.from(prompt).toString('base64').substring(0, 32);
    }
    
    private cleanCache() {
        const now = Date.now();
        for (const [key, value] of this.cache.entries()) {
            if (now - value.timestamp > this.cacheTTL) {
                this.cache.delete(key);
            }
        }
    }
}
```

## Next Steps

After mastering token and request limits, explore:

1. [**Session Management**](./session-management.md) - Managing usage across sessions
2. [**Provider Switching**](./provider-switching.md) - Cost optimization across providers
3. [**Custom Function Providers**](./custom-function-providers.md) - Building efficient custom tools

## Troubleshooting

### Budget Exceeded
- Review usage patterns and identify high-cost operations
- Implement stricter rate limiting
- Consider using more cost-effective models
- Optimize prompts to reduce token usage

### Rate Limiting Issues
- Implement proper request queuing
- Use exponential backoff for retries
- Monitor API rate limits and quotas
- Consider distributing load across multiple API keys

### Token Optimization
- Use prompt optimization techniques
- Implement response caching
- Consider prompt templates for common queries
- Monitor token usage patterns for optimization opportunities 