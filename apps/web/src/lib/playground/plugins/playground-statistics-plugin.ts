/**
 * Playground Statistics Plugin
 * 
 * Playground UI/UX에 특화된 통계 수집 플러그인
 * - BasePlugin 직접 상속
 * - Playground 전용 메트릭 정의
 * - 다른 프로젝트와 공통화 고려하지 않음
 */

import { BasePlugin, PluginCategory, PluginPriority } from '@robota-sdk/agents';
import { SilentLogger, type SimpleLogger } from '@robota-sdk/agents';
import type { EventType, EventData } from '@robota-sdk/agents';
import {
    PlaygroundStatisticsOptions,
    PlaygroundStatisticsStats,
    PlaygroundMetrics,
    PlaygroundExecutionResult,
    PlaygroundAction,
    PlaygroundStatisticsEventType,
    PlaygroundStatisticsEventData,
    defaultPlaygroundStats,
    defaultPlaygroundStatisticsOptions
} from '../../../types/playground-statistics';

/**
 * Playground 전용 통계 플러그인
 * 
 * @example
 * ```typescript
 * const statisticsPlugin = new PlaygroundStatisticsPlugin({
 *   enabled: true,
 *   collectUIMetrics: true,
 *   trackResponseTime: true
 * });
 * 
 * // Robota agent에 플러그인 주입
 * agent.addPlugin(statisticsPlugin);
 * 
 * // 통계 조회
 * const stats = statisticsPlugin.getPlaygroundStats();
 * ```
 */
export class PlaygroundStatisticsPlugin extends BasePlugin<
    PlaygroundStatisticsOptions,
    PlaygroundStatisticsStats
> {
    readonly name = 'PlaygroundStatisticsPlugin';
    readonly version = '1.0.0';
    readonly category = PluginCategory.MONITORING;
    readonly priority = PluginPriority.HIGH;

    private readonly logger: SimpleLogger;
    private readonly options: Required<PlaygroundStatisticsOptions>;

    // Playground 특화 메트릭 상태
    private playgroundMetrics: PlaygroundMetrics;
    private executionHistory: PlaygroundExecutionResult[] = [];
    private actionHistory: PlaygroundAction[] = [];

    // 실행 시간 추적을 위한 내부 상태
    private executionStartTimes: Map<string, number> = new Map();
    private sessionStartTime: Date = new Date();

    constructor(options: PlaygroundStatisticsOptions = {}) {
        super();

        this.logger = options.logger || SilentLogger;
        this.options = { ...defaultPlaygroundStatisticsOptions, ...options };

        // 초기 메트릭 설정
        this.playgroundMetrics = { ...defaultPlaygroundStats };

        // 세션 시작 시 통계 초기화 (옵션에 따라)
        if (this.options.resetOnSessionStart) {
            this.resetStatistics();
        }

        this.logger.info('PlaygroundStatisticsPlugin initialized', {
            enabled: this.options.enabled,
            collectUIMetrics: this.options.collectUIMetrics,
            trackResponseTime: this.options.trackResponseTime,
            maxEntries: this.options.maxEntries
        });
    }

    // ==========================================================================
    // BasePlugin Override Methods
    // ==========================================================================

    /**
     * SDK 모듈 이벤트 처리 (자동 통계 수집)
     */
    override async onModuleEvent(eventType: EventType, eventData: EventData): Promise<void> {
        if (!this.options.enabled) return;

        try {
            const moduleData = eventData.data;
            const executionId = eventData.executionId || this.generateExecutionId();

            switch (eventType) {
                case 'execution.start':
                    await this.handleExecutionStart(executionId, moduleData);
                    break;

                case 'execution.complete':
                    await this.handleExecutionComplete(executionId, moduleData);
                    break;

                case 'execution.error':
                    await this.handleExecutionError(executionId, moduleData, eventData.error);
                    break;

                case 'tool.execute.start':
                case 'tool.execute.complete':
                    // Tool 실행도 UI 인터랙션으로 추적
                    if (this.options.collectUIMetrics) {
                        await this.recordUIInteraction('tool_execution');
                    }
                    break;

                default:
                    // 기타 모듈 이벤트도 필요에 따라 처리
                    break;
            }
        } catch (error) {
            // 통계 수집 실패가 전체 시스템에 영향을 주지 않도록 에러 무시
            this.logger.warn('Failed to process module event for statistics', {
                eventType,
                error: error instanceof Error ? error.message : String(error)
            });
        }
    }

    // ==========================================================================
    // Playground 특화 Public Methods
    // ==========================================================================

    /**
     * Playground 실행 결과 기록
     */
    async recordPlaygroundExecution(result: PlaygroundExecutionResult): Promise<void> {
        if (!this.options.enabled || !this.options.trackExecutionDetails) return;

        try {
            // 실행 이력에 추가
            this.executionHistory.push(result);

            // 최대 항목 수 제한
            if (this.executionHistory.length > this.options.maxEntries) {
                this.executionHistory = this.executionHistory.slice(-this.options.maxEntries);
            }

            // 메트릭 업데이트
            await this.updateExecutionMetrics(result);

            // 느린 실행에 대한 경고
            if (result.duration > this.options.slowExecutionThreshold) {
                this.logger.warn('Slow execution detected', {
                    duration: result.duration,
                    threshold: this.options.slowExecutionThreshold,
                    provider: result.provider,
                    model: result.model,
                    mode: result.mode
                });
            }

            this.logger.debug('Playground execution recorded', {
                success: result.success,
                duration: result.duration,
                mode: result.mode,
                streaming: result.streaming
            });
        } catch (error) {
            this.logger.error('Failed to record playground execution', {
                error: error instanceof Error ? error.message : String(error)
            });
        }
    }

    /**
     * 블록 생성 기록
     */
    async recordBlockCreation(blockType: string, metadata?: Record<string, any>): Promise<void> {
        if (!this.options.enabled || !this.options.collectBlockMetrics) return;

        try {
            this.playgroundMetrics.blockCreations++;
            this.playgroundMetrics.lastUpdated = new Date();

            // UI 인터랙션으로도 기록
            await this.recordUIInteraction('block_create', { blockType, ...metadata });

            this.logger.debug('Block creation recorded', { blockType, metadata });
        } catch (error) {
            this.logger.error('Failed to record block creation', {
                blockType,
                error: error instanceof Error ? error.message : String(error)
            });
        }
    }

    /**
     * UI 인터랙션 기록
     */
    async recordUIInteraction(interactionType: string, metadata?: Record<string, any>): Promise<void> {
        if (!this.options.enabled || !this.options.collectUIMetrics) return;

        try {
            const action: PlaygroundAction = {
                type: interactionType as PlaygroundAction['type'],
                timestamp: new Date(),
                metadata
            };

            this.actionHistory.push(action);

            // 최대 항목 수 제한
            if (this.actionHistory.length > this.options.maxEntries) {
                this.actionHistory = this.actionHistory.slice(-this.options.maxEntries);
            }

            this.playgroundMetrics.uiInteractions++;
            this.playgroundMetrics.lastUpdated = new Date();

            this.logger.debug('UI interaction recorded', { interactionType, metadata });
        } catch (error) {
            this.logger.error('Failed to record UI interaction', {
                interactionType,
                error: error instanceof Error ? error.message : String(error)
            });
        }
    }

    /**
     * Playground 통계 조회
     */
    getPlaygroundStats(): PlaygroundMetrics {
        return {
            ...this.playgroundMetrics,
            successRate: this.calculateSuccessRate(),
            isActive: this.isCurrentlyActive()
        };
    }

    /**
     * 상세 통계 데이터 조회
     */
    getDetailedStats(): PlaygroundStatisticsStats {
        return {
            metrics: this.getPlaygroundStats(),
            executionHistory: [...this.executionHistory],
            actionHistory: [...this.actionHistory],
            aggregatedStats: this.calculateAggregatedStats(),
            timeBasedStats: this.calculateTimeBasedStats()
        };
    }

    /**
     * 통계 초기화
     */
    resetStatistics(): void {
        this.playgroundMetrics = { ...defaultPlaygroundStats };
        this.executionHistory = [];
        this.actionHistory = [];
        this.executionStartTimes.clear();
        this.sessionStartTime = new Date();

        this.logger.info('Playground statistics reset');
    }

    // ==========================================================================
    // Private Helper Methods
    // ==========================================================================

    private async handleExecutionStart(executionId: string, moduleData: any): Promise<void> {
        this.executionStartTimes.set(executionId, Date.now());
        this.playgroundMetrics.isActive = true;
    }

    private async handleExecutionComplete(executionId: string, moduleData: any): Promise<void> {
        const startTime = this.executionStartTimes.get(executionId);
        if (startTime) {
            const duration = Date.now() - startTime;
            this.executionStartTimes.delete(executionId);

            // 실행 결과 구성
            const result: PlaygroundExecutionResult = {
                success: true,
                duration,
                provider: moduleData?.provider || 'unknown',
                model: moduleData?.model || 'unknown',
                mode: moduleData?.mode || 'agent',
                streaming: moduleData?.streaming || false,
                timestamp: new Date(),
                usage: moduleData?.usage
            };

            await this.recordPlaygroundExecution(result);
        }

        this.playgroundMetrics.isActive = this.executionStartTimes.size > 0;
    }

    private async handleExecutionError(executionId: string, moduleData: any, error?: Error): Promise<void> {
        const startTime = this.executionStartTimes.get(executionId);
        if (startTime) {
            const duration = Date.now() - startTime;
            this.executionStartTimes.delete(executionId);

            const result: PlaygroundExecutionResult = {
                success: false,
                duration,
                provider: moduleData?.provider || 'unknown',
                model: moduleData?.model || 'unknown',
                mode: moduleData?.mode || 'agent',
                streaming: moduleData?.streaming || false,
                timestamp: new Date(),
                error: error?.message || 'Unknown error'
            };

            await this.recordPlaygroundExecution(result);
        }

        this.playgroundMetrics.isActive = this.executionStartTimes.size > 0;
    }

    private async updateExecutionMetrics(result: PlaygroundExecutionResult): Promise<void> {
        // 총 실행 수 증가
        this.playgroundMetrics.totalChatExecutions++;

        // 모드별 실행 수 증가
        if (result.mode === 'agent') {
            this.playgroundMetrics.agentModeExecutions++;
        } else if (result.mode === 'team') {
            this.playgroundMetrics.teamModeExecutions++;
        }

        // 스트리밍 실행 수
        if (result.streaming) {
            this.playgroundMetrics.streamingExecutions++;
        }

        // 에러 카운트
        if (!result.success) {
            this.playgroundMetrics.errorCount++;
        }

        // 평균 응답 시간 업데이트
        this.playgroundMetrics.averageResponseTime = this.calculateAverageResponseTime();
        this.playgroundMetrics.lastExecutionTime = result.duration;
        this.playgroundMetrics.lastUpdated = new Date();
    }

    private calculateSuccessRate(): number {
        if (this.playgroundMetrics.totalChatExecutions === 0) return 100;

        const successCount = this.playgroundMetrics.totalChatExecutions - this.playgroundMetrics.errorCount;
        return Math.round((successCount / this.playgroundMetrics.totalChatExecutions) * 100);
    }

    private calculateAverageResponseTime(): number {
        if (this.executionHistory.length === 0) return 0;

        const totalTime = this.executionHistory.reduce((sum, exec) => sum + exec.duration, 0);
        return Math.round(totalTime / this.executionHistory.length);
    }

    private isCurrentlyActive(): boolean {
        return this.executionStartTimes.size > 0;
    }

    private calculateAggregatedStats() {
        // 집계 통계 계산 로직
        const providerUsage: Record<string, number> = {};
        const modelUsage: Record<string, number> = {};
        const errorCounts: Record<string, number> = {};

        for (const exec of this.executionHistory) {
            providerUsage[exec.provider] = (providerUsage[exec.provider] || 0) + 1;
            modelUsage[exec.model] = (modelUsage[exec.model] || 0) + 1;

            if (exec.error) {
                errorCounts[exec.error] = (errorCounts[exec.error] || 0) + 1;
            }
        }

        const topErrors = Object.entries(errorCounts)
            .map(([error, count]) => ({ error, count }))
            .sort((a, b) => b.count - a.count)
            .slice(0, 5);

        const totalExecutionTime = this.executionHistory.reduce((sum, exec) => sum + exec.duration, 0);
        const sessionDuration = Date.now() - this.sessionStartTime.getTime();

        return {
            sessionsCount: 1, // 현재는 단일 세션
            totalExecutionTime,
            averageSessionDuration: sessionDuration,
            topErrors,
            providerUsage,
            modelUsage
        };
    }

    private calculateTimeBasedStats() {
        // 시간대별 통계 계산 (간단한 구현)
        const hourlyExecutions = new Array(24).fill(0);
        const dailyExecutions = new Array(7).fill(0);

        for (const exec of this.executionHistory) {
            const hour = exec.timestamp.getHours();
            const day = exec.timestamp.getDay();

            hourlyExecutions[hour]++;
            dailyExecutions[day]++;
        }

        const peakUsageHour = hourlyExecutions.indexOf(Math.max(...hourlyExecutions));

        return {
            hourlyExecutions,
            dailyExecutions,
            peakUsageHour
        };
    }

    private generateExecutionId(): string {
        return `exec_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }
} 