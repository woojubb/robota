/**
 * Request Limit Manager class
 * Manages request count and token limits with default values
 */
export class RequestLimitManager {
    private maxTokens: number;
    private maxRequests: number;
    private currentTokensUsed: number = 0;
    private currentRequestCount: number = 0;

    constructor(maxTokens: number = 4096, maxRequests: number = 25) {
        this.maxTokens = maxTokens;
        this.maxRequests = maxRequests;
    }

    /**
     * Set maximum token limit (0 = unlimited)
     */
    setMaxTokens(limit: number): void {
        if (limit < 0) {
            throw new Error('Max token limit cannot be negative');
        }
        this.maxTokens = limit;
    }

    /**
     * Set maximum request limit (0 = unlimited)
     */
    setMaxRequests(limit: number): void {
        if (limit < 0) {
            throw new Error('Max request limit cannot be negative');
        }
        this.maxRequests = limit;
    }

    /**
     * Get current maximum token limit
     */
    getMaxTokens(): number {
        return this.maxTokens;
    }

    /**
     * Get current maximum request limit
     */
    getMaxRequests(): number {
        return this.maxRequests;
    }

    /**
     * Check if adding estimated tokens would exceed the limit
     * @param estimatedTokens - Estimated number of tokens to add
     * @throws Error if token limit would be exceeded
     */
    checkEstimatedTokenLimit(estimatedTokens: number): void {
        // Skip check if unlimited (0)
        if (this.maxTokens === 0) return;

        if ((this.currentTokensUsed + estimatedTokens) > this.maxTokens) {
            throw new Error(
                `Estimated token limit would be exceeded. Current usage: ${this.currentTokensUsed}, ` +
                `estimated additional tokens: ${estimatedTokens}, limit: ${this.maxTokens}. ` +
                `Request aborted to prevent unnecessary costs.`
            );
        }
    }

    /**
     * Check if adding new tokens would exceed the limit
     * @param tokensToAdd - Number of tokens to add
     * @throws Error if token limit would be exceeded
     */
    checkTokenLimit(tokensToAdd: number): void {
        // Skip check if unlimited (0)
        if (this.maxTokens === 0) return;

        if ((this.currentTokensUsed + tokensToAdd) > this.maxTokens) {
            throw new Error(
                `Token limit exceeded. Current usage: ${this.currentTokensUsed}, ` +
                `attempting to add: ${tokensToAdd}, limit: ${this.maxTokens}`
            );
        }
    }

    /**
     * Check if adding a new request would exceed the request limit
     * @throws Error if request limit would be exceeded
     */
    checkRequestLimit(): void {
        // Skip check if unlimited (0)
        if (this.maxRequests === 0) return;

        if ((this.currentRequestCount + 1) > this.maxRequests) {
            throw new Error(
                `Request limit exceeded. Current requests: ${this.currentRequestCount}, ` +
                `limit: ${this.maxRequests}`
            );
        }
    }

    /**
     * Record a successful request with token usage
     * @param tokensUsed - Number of tokens used in this request
     */
    recordRequest(tokensUsed: number): void {
        // First check if we can add this request and tokens
        this.checkRequestLimit();
        this.checkTokenLimit(tokensUsed);

        // If checks pass, record the usage
        this.currentRequestCount++;
        this.currentTokensUsed += tokensUsed;
    }

    /**
     * Get current token usage
     */
    getCurrentTokensUsed(): number {
        return this.currentTokensUsed;
    }

    /**
     * Get current request count
     */
    getCurrentRequestCount(): number {
        return this.currentRequestCount;
    }

    /**
     * Get remaining tokens (undefined if unlimited)
     */
    getRemainingTokens(): number | undefined {
        if (this.maxTokens === 0) return undefined;
        return Math.max(0, this.maxTokens - this.currentTokensUsed);
    }

    /**
     * Get remaining requests (undefined if unlimited)
     */
    getRemainingRequests(): number | undefined {
        if (this.maxRequests === 0) return undefined;
        return Math.max(0, this.maxRequests - this.currentRequestCount);
    }

    /**
     * Check if tokens are unlimited
     */
    isTokensUnlimited(): boolean {
        return this.maxTokens === 0;
    }

    /**
     * Check if requests are unlimited
     */
    isRequestsUnlimited(): boolean {
        return this.maxRequests === 0;
    }

    /**
     * Reset usage counters (but keep limits)
     */
    reset(): void {
        this.currentTokensUsed = 0;
        this.currentRequestCount = 0;
    }

    /**
     * Get comprehensive limit information
     */
    getLimitInfo(): {
        maxTokens: number;
        maxRequests: number;
        currentTokensUsed: number;
        currentRequestCount: number;
        remainingTokens?: number;
        remainingRequests?: number;
        isTokensUnlimited: boolean;
        isRequestsUnlimited: boolean;
    } {
        return {
            maxTokens: this.maxTokens,
            maxRequests: this.maxRequests,
            currentTokensUsed: this.currentTokensUsed,
            currentRequestCount: this.currentRequestCount,
            remainingTokens: this.getRemainingTokens(),
            remainingRequests: this.getRemainingRequests(),
            isTokensUnlimited: this.isTokensUnlimited(),
            isRequestsUnlimited: this.isRequestsUnlimited()
        };
    }
} 