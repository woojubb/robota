import type { AnalyticsManager } from '../managers/analytics-manager';
import type { RequestLimitManager } from '../managers/request-limit-manager';

/**
 * Analytics and limit related pure functions
 * Separated analytics and limit related logic from Robota class into pure functions
 */

/**
 * Pure function to set maximum token limit
 */
export function setMaxTokenLimit(
    limit: number,
    requestLimitManager: RequestLimitManager
): void {
    requestLimitManager.setMaxTokens(limit);
}

/**
 * Pure function to set maximum request limit
 */
export function setMaxRequestLimit(
    limit: number,
    requestLimitManager: RequestLimitManager
): void {
    requestLimitManager.setMaxRequests(limit);
}

/**
 * Pure function to get maximum token limit
 */
export function getMaxTokenLimit(
    requestLimitManager: RequestLimitManager
): number {
    return requestLimitManager.getMaxTokens();
}

/**
 * Pure function to get maximum request limit
 */
export function getMaxRequestLimit(
    requestLimitManager: RequestLimitManager
): number {
    return requestLimitManager.getMaxRequests();
}

/**
 * Pure function to get limit information
 */
export function getLimitInfo(
    requestLimitManager: RequestLimitManager
): {
    requests: { used: number; max: number };
    tokens: { used: number; max: number };
} {
    const info = requestLimitManager.getLimitInfo();
    return {
        requests: { used: info.currentRequestCount, max: info.maxRequests },
        tokens: { used: info.currentTokensUsed, max: info.maxTokens }
    };
}

/**
 * Pure function to get request count
 */
export function getRequestCount(
    requestLimitManager: RequestLimitManager
): number {
    return requestLimitManager.getCurrentRequestCount();
}

/**
 * Pure function to get total tokens used
 */
export function getTotalTokensUsed(
    requestLimitManager: RequestLimitManager
): number {
    return requestLimitManager.getCurrentTokensUsed();
}

/**
 * Pure function to get analytics data
 */
export function getAnalytics(
    analyticsManager: AnalyticsManager
): any {
    return analyticsManager.getAnalytics();
}

/**
 * Pure function to reset analytics data
 */
export function resetAnalytics(
    analyticsManager: AnalyticsManager,
    requestLimitManager: RequestLimitManager
): void {
    analyticsManager.reset();
    requestLimitManager.reset();
}

/**
 * Pure function to get token usage by period
 */
export function getTokenUsageByPeriod(
    startDate: Date,
    endDate: Date | undefined,
    analyticsManager: AnalyticsManager
): any {
    return analyticsManager.getTokenUsageByPeriod(startDate, endDate);
} 