import type { AnalyticsManager } from '../managers/analytics-manager';
import type { RequestLimitManager } from '../managers/request-limit-manager';

/**
 * 분석 및 제한 관련 순수 함수들
 * Robota 클래스의 분석 및 제한 관련 로직을 순수 함수로 분리
 */

/**
 * 최대 토큰 제한을 설정하는 순수 함수
 */
export function setMaxTokenLimit(
    limit: number,
    requestLimitManager: RequestLimitManager
): void {
    requestLimitManager.setMaxTokens(limit);
}

/**
 * 최대 요청 제한을 설정하는 순수 함수
 */
export function setMaxRequestLimit(
    limit: number,
    requestLimitManager: RequestLimitManager
): void {
    requestLimitManager.setMaxRequests(limit);
}

/**
 * 최대 토큰 제한을 가져오는 순수 함수
 */
export function getMaxTokenLimit(
    requestLimitManager: RequestLimitManager
): number {
    return requestLimitManager.getMaxTokens();
}

/**
 * 최대 요청 제한을 가져오는 순수 함수
 */
export function getMaxRequestLimit(
    requestLimitManager: RequestLimitManager
): number {
    return requestLimitManager.getMaxRequests();
}

/**
 * 제한 정보를 가져오는 순수 함수
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
 * 요청 횟수를 가져오는 순수 함수
 */
export function getRequestCount(
    requestLimitManager: RequestLimitManager
): number {
    return requestLimitManager.getCurrentRequestCount();
}

/**
 * 총 사용된 토큰 수를 가져오는 순수 함수
 */
export function getTotalTokensUsed(
    requestLimitManager: RequestLimitManager
): number {
    return requestLimitManager.getCurrentTokensUsed();
}

/**
 * 분석 데이터를 가져오는 순수 함수
 */
export function getAnalytics(
    analyticsManager: AnalyticsManager
): any {
    return analyticsManager.getAnalytics();
}

/**
 * 분석 데이터를 리셋하는 순수 함수
 */
export function resetAnalytics(
    analyticsManager: AnalyticsManager,
    requestLimitManager: RequestLimitManager
): void {
    analyticsManager.reset();
    requestLimitManager.reset();
}

/**
 * 기간별 토큰 사용량을 가져오는 순수 함수
 */
export function getTokenUsageByPeriod(
    startDate: Date,
    endDate: Date | undefined,
    analyticsManager: AnalyticsManager
): any {
    return analyticsManager.getTokenUsageByPeriod(startDate, endDate);
} 