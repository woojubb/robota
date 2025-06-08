/**
 * Performance Monitor for Tool Performance Tracking
 * 
 * @module performance-monitor
 * @description
 * 도구 성능을 실시간으로 모니터링하고 지표를 수집하는 시스템을 제공합니다.
 */

import { CacheStats } from './cache-manager';
import { LazyLoadStats } from './lazy-loader';
import { ResourceStats } from './resource-manager';

/**
 * 성능 지표 인터페이스
 */
export interface PerformanceMetrics {
    /** 도구 호출 횟수 */
    toolCallCount: number;
    /** 평균 도구 호출 시간 (밀리초) */
    averageCallTime: number;
    /** 최대 도구 호출 시간 (밀리초) */
    maxCallTime: number;
    /** 최소 도구 호출 시간 (밀리초) */
    minCallTime: number;
    /** 성공한 호출 수 */
    successfulCalls: number;
    /** 실패한 호출 수 */
    failedCalls: number;
    /** 성공률 (0-1) */
    successRate: number;
    /** 초당 처리량 (TPS - Transactions Per Second) */
    throughput: number;
    /** 메모리 사용량 통계 */
    memoryUsage: MemoryUsageMetrics;
    /** 캐시 성능 통계 */
    cacheMetrics: CacheStats | null;
    /** 지연 로딩 통계 */
    lazyLoadMetrics: LazyLoadStats | null;
    /** 리소스 관리 통계 */
    resourceMetrics: ResourceStats | null;
}

/**
 * 메모리 사용량 지표
 */
export interface MemoryUsageMetrics {
    /** 현재 힙 사용량 (바이트) */
    currentHeapUsed: number;
    /** 최대 힙 사용량 (바이트) */
    maxHeapUsed: number;
    /** 평균 힙 사용량 (바이트) */
    averageHeapUsed: number;
    /** 외부 메모리 사용량 (바이트) */
    external: number;
    /** RSS (Resident Set Size) */
    rss: number;
}

/**
 * 도구 호출 기록
 */
export interface ToolCallRecord {
    /** 도구 이름 */
    toolName: string;
    /** 호출 시작 시간 */
    startTime: number;
    /** 호출 종료 시간 */
    endTime: number;
    /** 실행 시간 (밀리초) */
    duration: number;
    /** 성공 여부 */
    success: boolean;
    /** 에러 메시지 (실패 시) */
    error?: string;
    /** 매개변수 크기 (바이트) */
    parameterSize: number;
    /** 응답 크기 (바이트) */
    responseSize: number;
}

/**
 * 성능 이벤트 리스너 타입
 */
export type PerformanceEventListener = (metrics: PerformanceMetrics) => void;

/**
 * 성능 모니터 클래스
 */
export class PerformanceMonitor {
    private callRecords: ToolCallRecord[] = [];
    private memorySnapshots: number[] = [];
    private maxRecords: number;
    private monitoringInterval?: NodeJS.Timeout;
    private eventListeners: PerformanceEventListener[] = [];
    private isMonitoring = false;

    // 외부 통계 소스
    private cacheStatsProvider?: () => CacheStats;
    private lazyLoadStatsProvider?: () => LazyLoadStats;
    private resourceStatsProvider?: () => ResourceStats;

    constructor(options: {
        maxRecords?: number; // 기본값: 10000
        monitoringIntervalMs?: number; // 기본값: 5초
    } = {}) {
        this.maxRecords = options.maxRecords || 10000;

        if (options.monitoringIntervalMs) {
            this.startMonitoring(options.monitoringIntervalMs);
        }
    }

    /**
     * 모니터링 시작
     */
    startMonitoring(intervalMs: number = 5000): void {
        if (this.isMonitoring) {
            return;
        }

        this.isMonitoring = true;
        this.monitoringInterval = setInterval(() => {
            this.collectMetrics();
        }, intervalMs);
    }

    /**
     * 모니터링 중지
     */
    stopMonitoring(): void {
        if (!this.isMonitoring) {
            return;
        }

        this.isMonitoring = false;
        if (this.monitoringInterval) {
            clearInterval(this.monitoringInterval);
            this.monitoringInterval = undefined;
        }
    }

    /**
     * 도구 호출 기록
     */
    recordToolCall(record: ToolCallRecord): void {
        this.callRecords.push(record);

        // 레코드 수 제한
        if (this.callRecords.length > this.maxRecords) {
            const removeCount = Math.floor(this.maxRecords * 0.1); // 10% 제거
            this.callRecords.splice(0, removeCount);
        }

        // 메모리 스냅샷 수집
        this.collectMemorySnapshot();
    }

    /**
     * 도구 호출 시작 시간 기록을 위한 헬퍼
     */
    startToolCall(toolName: string, parameters: any): string {
        const callId = `${toolName}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        const parameterSize = this.estimateObjectSize(parameters);

        // 임시 저장용 (실제 구현에서는 WeakMap 등 사용 고려)
        (this as any)._pendingCalls = (this as any)._pendingCalls || new Map();
        (this as any)._pendingCalls.set(callId, {
            toolName,
            startTime: performance.now(),
            parameterSize
        });

        return callId;
    }

    /**
     * 도구 호출 완료 기록을 위한 헬퍼
     */
    endToolCall(callId: string, success: boolean, response?: any, error?: string): void {
        const pendingCalls = (this as any)._pendingCalls;
        if (!pendingCalls || !pendingCalls.has(callId)) {
            return;
        }

        const pending = pendingCalls.get(callId);
        pendingCalls.delete(callId);

        const endTime = performance.now();
        const responseSize = response ? this.estimateObjectSize(response) : 0;

        this.recordToolCall({
            toolName: pending.toolName,
            startTime: pending.startTime,
            endTime,
            duration: endTime - pending.startTime,
            success,
            error,
            parameterSize: pending.parameterSize,
            responseSize
        });
    }

    /**
     * 외부 통계 제공자 등록
     */
    setCacheStatsProvider(provider: () => CacheStats): void {
        this.cacheStatsProvider = provider;
    }

    setLazyLoadStatsProvider(provider: () => LazyLoadStats): void {
        this.lazyLoadStatsProvider = provider;
    }

    setResourceStatsProvider(provider: () => ResourceStats): void {
        this.resourceStatsProvider = provider;
    }

    /**
     * 이벤트 리스너 등록
     */
    addEventListener(listener: PerformanceEventListener): void {
        this.eventListeners.push(listener);
    }

    /**
     * 이벤트 리스너 제거
     */
    removeEventListener(listener: PerformanceEventListener): void {
        const index = this.eventListeners.indexOf(listener);
        if (index > -1) {
            this.eventListeners.splice(index, 1);
        }
    }

    /**
     * 현재 성능 지표 조회
     */
    getMetrics(): PerformanceMetrics {
        const now = performance.now();
        const recentRecords = this.callRecords.filter(
            record => now - record.endTime < 60000 // 최근 1분
        );

        // 기본 통계 계산
        const totalCalls = this.callRecords.length;
        const successfulCalls = this.callRecords.filter(r => r.success).length;
        const failedCalls = totalCalls - successfulCalls;
        const successRate = totalCalls > 0 ? successfulCalls / totalCalls : 0;

        // 시간 통계
        const durations = this.callRecords.map(r => r.duration);
        const averageCallTime = durations.length > 0
            ? durations.reduce((sum, d) => sum + d, 0) / durations.length
            : 0;
        const maxCallTime = durations.length > 0 ? Math.max(...durations) : 0;
        const minCallTime = durations.length > 0 ? Math.min(...durations) : 0;

        // 처리량 계산 (최근 1분간)
        const throughput = recentRecords.length / 60; // TPS

        // 메모리 통계
        const memoryUsage = this.calculateMemoryMetrics();

        return {
            toolCallCount: totalCalls,
            averageCallTime,
            maxCallTime,
            minCallTime,
            successfulCalls,
            failedCalls,
            successRate,
            throughput,
            memoryUsage,
            cacheMetrics: this.cacheStatsProvider ? this.cacheStatsProvider() : null,
            lazyLoadMetrics: this.lazyLoadStatsProvider ? this.lazyLoadStatsProvider() : null,
            resourceMetrics: this.resourceStatsProvider ? this.resourceStatsProvider() : null
        };
    }

    /**
     * 특정 도구의 성능 지표 조회
     */
    getToolMetrics(toolName: string): Partial<PerformanceMetrics> {
        const toolRecords = this.callRecords.filter(r => r.toolName === toolName);

        if (toolRecords.length === 0) {
            return {
                toolCallCount: 0,
                averageCallTime: 0,
                maxCallTime: 0,
                minCallTime: 0,
                successfulCalls: 0,
                failedCalls: 0,
                successRate: 0,
                throughput: 0
            };
        }

        const successfulCalls = toolRecords.filter(r => r.success).length;
        const failedCalls = toolRecords.length - successfulCalls;
        const durations = toolRecords.map(r => r.duration);

        return {
            toolCallCount: toolRecords.length,
            averageCallTime: durations.reduce((sum, d) => sum + d, 0) / durations.length,
            maxCallTime: Math.max(...durations),
            minCallTime: Math.min(...durations),
            successfulCalls,
            failedCalls,
            successRate: successfulCalls / toolRecords.length,
            throughput: toolRecords.filter(r =>
                performance.now() - r.endTime < 60000
            ).length / 60
        };
    }

    /**
     * 성능 지표 리셋
     */
    reset(): void {
        this.callRecords = [];
        this.memorySnapshots = [];
    }

    /**
     * 성능 보고서 생성
     */
    generateReport(): string {
        const metrics = this.getMetrics();

        return `
=== Tool Performance Report ===
총 호출 수: ${metrics.toolCallCount}
성공률: ${(metrics.successRate * 100).toFixed(2)}%
평균 응답 시간: ${metrics.averageCallTime.toFixed(2)}ms
최대 응답 시간: ${metrics.maxCallTime.toFixed(2)}ms
최소 응답 시간: ${metrics.minCallTime.toFixed(2)}ms
처리량: ${metrics.throughput.toFixed(2)} TPS

메모리 사용량:
- 현재 힙: ${(metrics.memoryUsage.currentHeapUsed / 1024 / 1024).toFixed(2)}MB
- 최대 힙: ${(metrics.memoryUsage.maxHeapUsed / 1024 / 1024).toFixed(2)}MB
- 평균 힙: ${(metrics.memoryUsage.averageHeapUsed / 1024 / 1024).toFixed(2)}MB

${metrics.cacheMetrics ? `
캐시 성능:
- 히트율: ${(metrics.cacheMetrics.hitRate * 100).toFixed(2)}%
- 캐시 항목 수: ${metrics.cacheMetrics.totalItems}
- 메모리 사용량: ${(metrics.cacheMetrics.estimatedMemoryUsage / 1024).toFixed(2)}KB
` : ''}

${metrics.resourceMetrics ? `
리소스 관리:
- 총 리소스 수: ${metrics.resourceMetrics.totalResources}
- 메모리 사용량: ${(metrics.resourceMetrics.estimatedMemoryUsage / 1024 / 1024).toFixed(2)}MB
` : ''}
`.trim();
    }

    /**
     * 메모리 스냅샷 수집
     */
    private collectMemorySnapshot(): void {
        const memUsage = process.memoryUsage();
        this.memorySnapshots.push(memUsage.heapUsed);

        // 스냅샷 수 제한
        if (this.memorySnapshots.length > 1000) {
            this.memorySnapshots.splice(0, 100); // 오래된 것 100개 제거
        }
    }

    /**
     * 메모리 지표 계산
     */
    private calculateMemoryMetrics(): MemoryUsageMetrics {
        const memUsage = process.memoryUsage();

        return {
            currentHeapUsed: memUsage.heapUsed,
            maxHeapUsed: this.memorySnapshots.length > 0 ? Math.max(...this.memorySnapshots) : memUsage.heapUsed,
            averageHeapUsed: this.memorySnapshots.length > 0
                ? this.memorySnapshots.reduce((sum, snap) => sum + snap, 0) / this.memorySnapshots.length
                : memUsage.heapUsed,
            external: memUsage.external,
            rss: memUsage.rss
        };
    }

    /**
     * 지표 수집 및 이벤트 발생
     */
    private collectMetrics(): void {
        try {
            const metrics = this.getMetrics();

            // 이벤트 리스너들에게 알림
            for (const listener of this.eventListeners) {
                try {
                    listener(metrics);
                } catch (error) {
                    console.error('Performance event listener error:', error);
                }
            }
        } catch (error) {
            console.error('Failed to collect performance metrics:', error);
        }
    }

    /**
     * 객체 크기 추정
     */
    private estimateObjectSize(obj: any): number {
        if (obj === null || obj === undefined) {
            return 8;
        }

        switch (typeof obj) {
            case 'string':
                return obj.length * 2;
            case 'number':
                return 8;
            case 'boolean':
                return 4;
            case 'object':
                if (Array.isArray(obj)) {
                    return obj.reduce((acc, item) => acc + this.estimateObjectSize(item), 0);
                } else {
                    let size = 0;
                    for (const key in obj) {
                        size += key.length * 2;
                        size += this.estimateObjectSize(obj[key]);
                    }
                    return size;
                }
            default:
                return 16;
        }
    }
}

/**
 * 전역 성능 모니터 인스턴스
 */
export const globalPerformanceMonitor = new PerformanceMonitor({
    maxRecords: 10000,
    monitoringIntervalMs: 5000
}); 