/**
 * Real-Time Event Integration System
 * 
 * Purpose: 실시간 이벤트 기반 React-Flow 업데이트 시스템
 * Architecture: Observer + Mediator Pattern으로 이벤트 기반 시각화 업데이트
 * Features: 이벤트 필터링, 업데이트 배칭, 성능 최적화, 오류 복구
 */

import { EventService } from './event-service';
import { RealTimeWorkflowBuilder } from './real-time-workflow-builder';
import { RealTimeReactFlowGenerator } from './real-time-react-flow-generator';
import type { SimpleLogger } from '../utils/simple-logger';
import { SilentLogger } from '../utils/simple-logger';
// import type { ReactFlowData } from './react-flow/types'; // MOVED: React-Flow types moved to apps/web
import type { RealTimeReactFlowResult } from './real-time-react-flow-generator';
// import type { RealTimeReactFlowConfig } from './real-time-workflow-builder';
type RealTimeReactFlowConfig = Record<string, unknown>; // Temporary type definition
import type { GenericMetadata } from '../interfaces/base-types';

/**
 * Event Integration Configuration
 */
export interface EventIntegrationConfig {
    // 이벤트 필터링
    enableEventFiltering?: boolean;
    relevantEventTypes?: string[];

    // 업데이트 배칭
    enableUpdateBatching?: boolean;
    batchTimeout?: number; // milliseconds
    maxBatchSize?: number;

    // 성능 최적화
    enableThrottling?: boolean;
    throttleInterval?: number; // milliseconds

    // 오류 처리
    enableErrorRecovery?: boolean;
    maxRetries?: number;
    retryDelay?: number; // milliseconds

    // 디버깅
    enableDebugMode?: boolean;
    logEventDetails?: boolean;
}

/**
 * Event Processing Result
 */
export interface EventProcessingResult {
    success: boolean;
    processedEvents: number;
    skippedEvents: number;
    error?: string;
    processingTime: number;
    reactFlowResult?: RealTimeReactFlowResult;
}

/**
 * Batched Update Information
 */
interface BatchedUpdate {
    events: any[];
    timestamp: Date;
    timeout?: NodeJS.Timeout;
}

/**
 * Event Processing Metrics
 */
export interface EventProcessingMetrics {
    totalEvents: number;
    processedEvents: number;
    skippedEvents: number;
    errorEvents: number;
    averageProcessingTime: number;
    batchCount: number;
    throttleCount: number;
}

/**
 * RealTimeEventIntegration
 * 
 * Features:
 * - 실시간 이벤트 구독 및 필터링
 * - 이벤트 배칭으로 성능 최적화
 * - 스로틀링으로 과부하 방지
 * - 오류 복구 및 재시도 메커니즘
 * - 상세한 메트릭 수집
 */
export class RealTimeEventIntegration {

    private readonly logger: SimpleLogger;
    private readonly config: Required<EventIntegrationConfig>;
    private readonly eventService: EventService;
    private readonly workflowBuilder: RealTimeWorkflowBuilder;
    private readonly reactFlowGenerator: RealTimeReactFlowGenerator;

    // Batching system
    private currentBatch: BatchedUpdate | null = null;
    private readonly pendingEvents: any[] = [];

    // Throttling system
    private lastProcessTime = 0;
    private isProcessing = false;

    // Error handling
    private retryQueue: any[] = [];
    private errorCount = 0;

    // Metrics
    private readonly metrics: EventProcessingMetrics = {
        totalEvents: 0,
        processedEvents: 0,
        skippedEvents: 0,
        errorEvents: 0,
        averageProcessingTime: 0,
        batchCount: 0,
        throttleCount: 0
    };

    // Subscribers
    private readonly updateCallbacks: ((result: RealTimeReactFlowResult) => void)[] = [];

    constructor(
        eventService: EventService,
        workflowBuilder: RealTimeWorkflowBuilder,
        reactFlowConfig: RealTimeReactFlowConfig = {},
        integrationConfig: EventIntegrationConfig = {},
        logger: SimpleLogger = SilentLogger
    ) {
        this.logger = logger;
        this.eventService = eventService;
        this.workflowBuilder = workflowBuilder;

        // 설정 기본값 적용
        this.config = {
            enableEventFiltering: true,
            relevantEventTypes: [
                'agent_start',
                'agent_thinking_start',
                'agent_thinking_complete',
                'tool_call_start',
                'tool_call_complete',
                'conversation_end'
            ],
            enableUpdateBatching: true,
            batchTimeout: 500, // 500ms
            maxBatchSize: 10,
            enableThrottling: true,
            throttleInterval: 100, // 100ms
            enableErrorRecovery: true,
            maxRetries: 3,
            retryDelay: 1000, // 1초
            enableDebugMode: false,
            logEventDetails: false,
            ...integrationConfig
        } as Required<EventIntegrationConfig>;

        // React-Flow 제너레이터 초기화
        this.reactFlowGenerator = new RealTimeReactFlowGenerator(
            eventService,
            workflowBuilder,
            reactFlowConfig,
            logger
        );

        this.setupEventSubscription();
        this.setupReactFlowSubscription();

        this.logger.info('RealTimeEventIntegration initialized', {
            config: this.config
        });
    }

    /**
     * React-Flow 업데이트 구독
     */
    subscribeToUpdates(callback: (result: RealTimeReactFlowResult) => void): void {
        this.updateCallbacks.push(callback);
        this.logger.debug('New event integration update subscriber registered');
    }

    /**
     * 이벤트 구독 설정
     */
    private setupEventSubscription(): void {
        // EventService의 모든 이벤트 구독
        // TODO: EventService의 모든 이벤트 구독 - 현재 EventService에 on 메서드가 없음
        // EventService 인터페이스에 on 메서드 추가하거나 다른 이벤트 구독 방식 구현 필요
        // this.eventService.on('*', (eventType: string, data: any) => {
        //     this.handleEvent(eventType, data);
        // });

        this.logger.debug('Event subscription setup completed');
    }

    /**
     * React-Flow 제너레이터 구독 설정
     */
    private setupReactFlowSubscription(): void {
        this.reactFlowGenerator.subscribeToUpdates((result: RealTimeReactFlowResult) => {
            this.notifySubscribers(result);
        });

        this.logger.debug('React-Flow generator subscription setup completed');
    }

    /**
     * 개별 이벤트 처리
     */
    private async handleEvent(eventType: string, data: any): Promise<void> {
        this.metrics.totalEvents++;

        try {
            // 1. 이벤트 필터링
            if (this.config.enableEventFiltering && !this.isRelevantEvent(eventType)) {
                this.metrics.skippedEvents++;

                if (this.config.logEventDetails) {
                    this.logger.debug('Event skipped (not relevant)', { eventType });
                }
                return;
            }

            // 2. 스로틀링 확인
            if (this.config.enableThrottling && this.isThrottled()) {
                this.metrics.throttleCount++;

                if (this.config.logEventDetails) {
                    this.logger.debug('Event throttled', { eventType });
                }
                return;
            }

            // 3. 배칭 또는 즉시 처리
            if (this.config.enableUpdateBatching) {
                await this.addToBatch(eventType, data);
            } else {
                await this.processEventImmediately(eventType, data);
            }

        } catch (error) {
            this.metrics.errorEvents++;
            this.errorCount++;

            this.logger.error('Error handling event', {
                eventType,
                error,
                errorCount: this.errorCount
            });

            // 오류 복구 시도
            if (this.config.enableErrorRecovery) {
                this.addToRetryQueue({ eventType, data });
            }
        }
    }

    /**
     * 이벤트 관련성 확인
     */
    private isRelevantEvent(eventType: string): boolean {
        return this.config.relevantEventTypes.includes(eventType);
    }

    /**
     * 스로틀링 확인
     */
    private isThrottled(): boolean {
        const now = Date.now();
        const timeSinceLastProcess = now - this.lastProcessTime;

        return timeSinceLastProcess < this.config.throttleInterval;
    }

    /**
     * 배치에 이벤트 추가
     */
    private async addToBatch(eventType: string, data: any): Promise<void> {
        // 현재 배치가 없으면 새로 생성
        if (!this.currentBatch) {
            this.currentBatch = {
                events: [],
                timestamp: new Date()
            };

            // 배치 타임아웃 설정
            this.currentBatch.timeout = setTimeout(() => {
                this.processBatch();
            }, this.config.batchTimeout);
        }

        // 이벤트를 배치에 추가
        this.currentBatch.events.push({ eventType, data, timestamp: new Date() });

        // 최대 배치 크기 확인
        if (this.currentBatch.events.length >= this.config.maxBatchSize) {
            await this.processBatch();
        }
    }

    /**
     * 배치 처리
     */
    private async processBatch(): Promise<void> {
        if (!this.currentBatch || this.currentBatch.events.length === 0) {
            return;
        }

        const batch = this.currentBatch;
        this.currentBatch = null;

        // 타임아웃 정리
        if (batch.timeout) {
            clearTimeout(batch.timeout);
        }

        try {
            this.logger.debug('Processing event batch', {
                eventCount: batch.events.length,
                batchAge: Date.now() - batch.timestamp.getTime()
            });

            const startTime = Date.now();

            // React-Flow 데이터 재생성 (배치의 모든 이벤트에 대해 한 번만)
            const result = await this.reactFlowGenerator.generateReactFlowData();

            const processingTime = Date.now() - startTime;

            // 메트릭 업데이트
            this.metrics.batchCount++;
            this.metrics.processedEvents += batch.events.length;
            this.updateAverageProcessingTime(processingTime);

            this.lastProcessTime = Date.now();

            if (this.config.enableDebugMode) {
                this.logger.debug('Batch processing completed', {
                    eventCount: batch.events.length,
                    processingTime,
                    success: result.success
                });
            }

        } catch (error) {
            this.logger.error('Error processing batch', {
                error,
                eventCount: batch.events.length
            });

            // 배치 전체를 재시도 큐에 추가
            if (this.config.enableErrorRecovery) {
                batch.events.forEach(event => this.addToRetryQueue(event));
            }
        }
    }

    /**
     * 이벤트 즉시 처리
     */
    private async processEventImmediately(eventType: string, data: any): Promise<void> {
        if (this.isProcessing) {
            this.pendingEvents.push({ eventType, data });
            return;
        }

        this.isProcessing = true;

        try {
            const startTime = Date.now();

            // React-Flow 데이터 재생성
            const result = await this.reactFlowGenerator.generateReactFlowData();

            const processingTime = Date.now() - startTime;

            // 메트릭 업데이트
            this.metrics.processedEvents++;
            this.updateAverageProcessingTime(processingTime);

            this.lastProcessTime = Date.now();

            if (this.config.enableDebugMode) {
                this.logger.debug('Event processed immediately', {
                    eventType,
                    processingTime,
                    success: result.success
                });
            }

            // 대기 중인 이벤트 처리
            await this.processPendingEvents();

        } catch (error) {
            this.logger.error('Error processing event immediately', {
                eventType,
                error
            });

            if (this.config.enableErrorRecovery) {
                this.addToRetryQueue({ eventType, data });
            }
        } finally {
            this.isProcessing = false;
        }
    }

    /**
     * 대기 중인 이벤트 처리
     */
    private async processPendingEvents(): Promise<void> {
        while (this.pendingEvents.length > 0) {
            const event = this.pendingEvents.shift();
            if (event) {
                await this.processEventImmediately(event.eventType, event.data);
            }
        }
    }

    /**
     * 재시도 큐에 이벤트 추가
     */
    private addToRetryQueue(event: any): void {
        if (this.retryQueue.length < this.config.maxRetries * 10) { // 큐 크기 제한
            this.retryQueue.push({
                ...event,
                retryCount: 0,
                timestamp: new Date()
            });

            // 재시도 스케줄링
            setTimeout(() => {
                this.processRetryQueue();
            }, this.config.retryDelay);
        }
    }

    /**
     * 재시도 큐 처리
     */
    private async processRetryQueue(): Promise<void> {
        if (this.retryQueue.length === 0) {
            return;
        }

        const event = this.retryQueue.shift();
        if (!event) {
            return;
        }

        try {
            await this.processEventImmediately(event.eventType, event.data);
            this.logger.debug('Event retry successful', {
                eventType: event.eventType,
                retryCount: event.retryCount
            });

        } catch (error) {
            event.retryCount++;

            if (event.retryCount < this.config.maxRetries) {
                this.retryQueue.push(event);
                this.logger.warn('Event retry failed, will retry again', {
                    eventType: event.eventType,
                    retryCount: event.retryCount,
                    maxRetries: this.config.maxRetries
                });
            } else {
                this.logger.error('Event retry exhausted', {
                    eventType: event.eventType,
                    retryCount: event.retryCount
                });
            }
        }
    }

    /**
     * 구독자들에게 업데이트 알림
     */
    private notifySubscribers(result: RealTimeReactFlowResult): void {
        this.updateCallbacks.forEach(callback => {
            try {
                callback(result);
            } catch (error) {
                this.logger.error('Error in event integration callback', { error });
            }
        });
    }

    /**
     * 평균 처리 시간 업데이트
     */
    private updateAverageProcessingTime(processingTime: number): void {
        const totalProcessed = this.metrics.processedEvents;
        const currentAverage = this.metrics.averageProcessingTime;

        this.metrics.averageProcessingTime =
            (currentAverage * (totalProcessed - 1) + processingTime) / totalProcessed;
    }

    /**
     * 이벤트 통계 정보
     */
    getEventStats(): EventProcessingMetrics & {
        pendingEvents: number;
        retryQueueSize: number;
        currentBatchSize: number;
        isProcessing: boolean;
        errorRate: number;
    } {
        const errorRate = this.metrics.totalEvents > 0
            ? this.metrics.errorEvents / this.metrics.totalEvents
            : 0;

        return {
            ...this.metrics,
            pendingEvents: this.pendingEvents.length,
            retryQueueSize: this.retryQueue.length,
            currentBatchSize: this.currentBatch?.events.length || 0,
            isProcessing: this.isProcessing,
            errorRate
        };
    }

    /**
     * 수동으로 React-Flow 데이터 새로고침
     */
    async refreshReactFlowData(): Promise<RealTimeReactFlowResult> {
        this.logger.debug('Manual React-Flow data refresh requested');

        try {
            const result = await this.reactFlowGenerator.generateReactFlowData();
            this.notifySubscribers(result);
            return result;
        } catch (error) {
            this.logger.error('Manual refresh failed', { error });
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Unknown refresh error'
            };
        }
    }

    /**
     * 설정 업데이트
     */
    updateConfig(newConfig: Partial<EventIntegrationConfig>): void {
        Object.assign(this.config, newConfig);
        this.logger.debug('Event integration configuration updated', { newConfig });
    }

    /**
     * 정리 작업
     */
    dispose(): void {
        // 현재 배치 정리
        if (this.currentBatch?.timeout) {
            clearTimeout(this.currentBatch.timeout);
        }

        // 큐 정리
        this.pendingEvents.length = 0;
        this.retryQueue.length = 0;
        this.updateCallbacks.length = 0;

        // React-Flow 제너레이터 정리
        this.reactFlowGenerator.dispose();

        this.logger.info('RealTimeEventIntegration disposed');
    }
}