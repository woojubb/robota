/**
 * Analytics Manager class
 * Manages analytics data collection (requests and token usage history)
 */
export class AnalyticsManager {
    private requestCount: number = 0;
    private totalTokensUsed: number = 0;
    private tokenUsageHistory: { timestamp: Date; tokens: number; provider: string; model: string }[] = [];

    /**
     * Record a new request and token usage
     * @param tokensUsed - Number of tokens used in this request
     * @param provider - AI provider name
     * @param model - Model name
     */
    recordRequest(tokensUsed: number, provider: string, model: string): void {
        this.requestCount++;
        this.totalTokensUsed += tokensUsed;

        this.tokenUsageHistory.push({
            timestamp: new Date(),
            tokens: tokensUsed,
            provider,
            model
        });
    }

    /**
     * Get total number of requests made
     */
    getRequestCount(): number {
        return this.requestCount;
    }

    /**
     * Get total number of tokens used
     */
    getTotalTokensUsed(): number {
        return this.totalTokensUsed;
    }

    /**
     * Get detailed analytics data
     */
    getAnalytics(): {
        requestCount: number;
        totalTokensUsed: number;
        averageTokensPerRequest: number;
        tokenUsageHistory: { timestamp: Date; tokens: number; provider: string; model: string }[];
    } {
        const averageTokensPerRequest = this.requestCount > 0 ? this.totalTokensUsed / this.requestCount : 0;

        return {
            requestCount: this.requestCount,
            totalTokensUsed: this.totalTokensUsed,
            averageTokensPerRequest: Math.round(averageTokensPerRequest * 100) / 100,
            tokenUsageHistory: [...this.tokenUsageHistory]
        };
    }

    /**
     * Reset all analytics data
     */
    reset(): void {
        this.requestCount = 0;
        this.totalTokensUsed = 0;
        this.tokenUsageHistory = [];
    }

    /**
     * Get token usage for a specific time period
     * @param startDate - Start date for the period
     * @param endDate - End date for the period (optional, defaults to now)
     */
    getTokenUsageByPeriod(startDate: Date, endDate?: Date): {
        totalTokens: number;
        requestCount: number;
        usageHistory: { timestamp: Date; tokens: number; provider: string; model: string }[];
    } {
        const end = endDate || new Date();

        const filteredHistory = this.tokenUsageHistory.filter(
            entry => entry.timestamp >= startDate && entry.timestamp <= end
        );

        const totalTokens = filteredHistory.reduce((sum, entry) => sum + entry.tokens, 0);

        return {
            totalTokens,
            requestCount: filteredHistory.length,
            usageHistory: filteredHistory
        };
    }
} 