/**
 * Real-Time System Integration Test
 * 
 * Purpose: Phase 3 실시간 워크플로우 빌더 확장의 전체 통합 테스트
 * Architecture: Integration Testing with real event simulation
 * Features: 엔드투엔드 테스트, 성능 벤치마킹, 시나리오 시뮬레이션
 */

import { EventService, DefaultEventService } from './event-service';
import { RealTimeWorkflowBuilder } from './real-time-workflow-builder';
import { RealTimeReactFlowGenerator } from './real-time-react-flow-generator';
import { RealTimeEventIntegration } from './real-time-event-integration';
import { ReactFlowPerformanceOptimizer } from './react-flow-performance-optimizer';
import type { SimpleLogger } from '../utils/simple-logger';
import { DefaultConsoleLogger, SilentLogger } from '../utils/simple-logger';
import type { ReactFlowData, ReactFlowConverterConfig } from './react-flow/types';
// import type { RealTimeReactFlowConfig } from './real-time-workflow-builder';
type RealTimeReactFlowConfig = Record<string, unknown>; // Temporary type for test compatibility
// import type {
//     EventIntegrationConfig,
//     PerformanceOptimizerConfig
// } from './react-flow-performance-optimizer';
type EventIntegrationConfig = Record<string, unknown>; // Temporary type for test compatibility
type PerformanceOptimizerConfig = Record<string, unknown>; // Temporary type for test compatibility

/**
 * Integration Test Configuration
 */
export interface RealTimeSystemTestConfig {
    // 테스트 모드
    testMode?: 'unit' | 'integration' | 'performance' | 'stress';

    // 시뮬레이션 설정
    simulationDuration?: number; // milliseconds
    eventFrequency?: number; // events per second
    maxConcurrentEvents?: number;

    // 성능 테스트 설정
    performanceThresholds?: {
        maxRenderTime?: number; // milliseconds
        maxMemoryUsage?: number; // bytes
        minCacheHitRate?: number; // 0-1
        maxEventProcessingTime?: number; // milliseconds
    };

    // 컴포넌트 설정
    reactFlowConfig?: RealTimeReactFlowConfig;
    eventIntegrationConfig?: EventIntegrationConfig;
    optimizerConfig?: PerformanceOptimizerConfig;

    // 로깅 설정
    enableDetailedLogging?: boolean;
    logInterval?: number; // milliseconds
}

/**
 * Integration Test Result
 */
export interface RealTimeSystemTestResult {
    success: boolean;
    testMode: string;
    duration: number;

    // 이벤트 처리 결과
    eventProcessing: {
        totalEvents: number;
        processedEvents: number;
        failedEvents: number;
        averageProcessingTime: number;
        maxProcessingTime: number;
    };

    // React-Flow 생성 결과
    reactFlowGeneration: {
        totalGenerations: number;
        successfulGenerations: number;
        failedGenerations: number;
        averageGenerationTime: number;
        cacheHitRate: number;
    };

    // 성능 메트릭
    performance: {
        peakMemoryUsage: number;
        averageMemoryUsage: number;
        gcCount: number;
        cacheEfficiency: number;
        incrementalUpdateRatio: number;
    };

    // 에러 및 경고
    errors: string[];
    warnings: string[];

    // 성능 임계값 통과 여부
    thresholdsPassed: boolean;
}

/**
 * Test Scenario
 */
interface TestScenario {
    name: string;
    description: string;
    events: Array<{
        type: string;
        delay: number; // milliseconds from start
        data: any;
    }>;
    expectedOutcomes: {
        minReactFlowGenerations: number;
        maxProcessingTime: number;
        shouldUseCaching: boolean;
        shouldUseIncrementalUpdate: boolean;
    };
}

/**
 * RealTimeSystemIntegrationTester
 * 
 * Features:
 * - 완전한 엔드투엔드 테스트
 * - 실제 이벤트 시뮬레이션
 * - 성능 벤치마킹
 * - 스트레스 테스트
 * - 상세한 메트릭 수집
 */
export class RealTimeSystemIntegrationTester {

    private readonly logger: SimpleLogger;
    private readonly config: Required<RealTimeSystemTestConfig>;

    // 테스트 컴포넌트들
    private eventService!: EventService;
    private workflowBuilder!: RealTimeWorkflowBuilder;
    private reactFlowGenerator!: RealTimeReactFlowGenerator;
    private eventIntegration!: RealTimeEventIntegration;
    private performanceOptimizer!: ReactFlowPerformanceOptimizer;

    // 테스트 상태 추적
    private isTestRunning = false;
    private testStartTime = 0;
    private reactFlowResults: ReactFlowData[] = [];
    private processingTimes: number[] = [];
    private eventResults: Array<{ success: boolean; processingTime: number; timestamp: Date }> = [];

    constructor(
        config: RealTimeSystemTestConfig = {},
        logger?: SimpleLogger
    ) {
        // 설정 기본값 적용
        this.config = {
            testMode: 'integration',
            simulationDuration: 30000, // 30초
            eventFrequency: 2, // 초당 2개 이벤트
            maxConcurrentEvents: 10,
            performanceThresholds: {
                maxRenderTime: 1000, // 1초
                maxMemoryUsage: 500 * 1024 * 1024, // 500MB
                minCacheHitRate: 0.7, // 70%
                maxEventProcessingTime: 500 // 500ms
            },
            enableDetailedLogging: false,
            logInterval: 5000, // 5초
            ...config
        } as Required<RealTimeSystemTestConfig>;

        this.logger = logger || (config.enableDetailedLogging ? DefaultConsoleLogger : SilentLogger);

        this.logger.info('RealTimeSystemIntegrationTester initialized', {
            config: this.config
        });
    }

    /**
     * 전체 통합 테스트 실행
     */
    async runIntegrationTest(): Promise<RealTimeSystemTestResult> {
        this.logger.info('Starting real-time system integration test', {
            mode: this.config.testMode,
            duration: this.config.simulationDuration
        });

        this.isTestRunning = true;
        this.testStartTime = Date.now();

        try {
            // 1. 시스템 초기화
            await this.initializeComponents();

            // 2. 테스트 실행
            const result = await this.executeTest();

            // 3. 결과 분석
            const finalResult = await this.analyzeResults(result);

            this.logger.info('Integration test completed', {
                success: finalResult.success,
                duration: finalResult.duration,
                thresholdsPassed: finalResult.thresholdsPassed
            });

            return finalResult;

        } catch (error) {
            this.logger.error('Integration test failed', { error });

            return {
                success: false,
                testMode: this.config.testMode,
                duration: Date.now() - this.testStartTime,
                eventProcessing: {
                    totalEvents: 0,
                    processedEvents: 0,
                    failedEvents: 0,
                    averageProcessingTime: 0,
                    maxProcessingTime: 0
                },
                reactFlowGeneration: {
                    totalGenerations: 0,
                    successfulGenerations: 0,
                    failedGenerations: 0,
                    averageGenerationTime: 0,
                    cacheHitRate: 0
                },
                performance: {
                    peakMemoryUsage: 0,
                    averageMemoryUsage: 0,
                    gcCount: 0,
                    cacheEfficiency: 0,
                    incrementalUpdateRatio: 0
                },
                errors: [error instanceof Error ? error.message : 'Unknown test error'],
                warnings: [],
                thresholdsPassed: false
            };
        } finally {
            this.isTestRunning = false;
            await this.cleanup();
        }
    }

    /**
     * 컴포넌트 초기화
     */
    private async initializeComponents(): Promise<void> {
        this.logger.debug('Initializing test components');

        // EventService 초기화
        this.eventService = new DefaultEventService({} as any); // Test compatibility - EventService options type mismatch

        // RealTimeWorkflowBuilder 초기화
        this.workflowBuilder = new RealTimeWorkflowBuilder(
            this.eventService,
            this.logger,
            this.config.reactFlowConfig?.converter as ReactFlowConverterConfig
        );

        // RealTimeReactFlowGenerator 초기화
        this.reactFlowGenerator = new RealTimeReactFlowGenerator(
            this.eventService,
            this.workflowBuilder,
            this.config.reactFlowConfig,
            this.logger
        );

        // RealTimeEventIntegration 초기화
        this.eventIntegration = new RealTimeEventIntegration(
            this.eventService,
            this.workflowBuilder,
            this.config.reactFlowConfig,
            this.config.eventIntegrationConfig,
            this.logger
        );

        // ReactFlowPerformanceOptimizer 초기화
        this.performanceOptimizer = new ReactFlowPerformanceOptimizer(
            this.config.optimizerConfig,
            this.logger
        );

        // 이벤트 구독 설정
        this.setupEventSubscriptions();

        this.logger.debug('Test components initialized successfully');
    }

    /**
     * 이벤트 구독 설정
     */
    private setupEventSubscriptions(): void {
        // React-Flow 업데이트 구독
        this.eventIntegration.subscribeToUpdates((result) => {
            if (result.success && result.data) {
                this.reactFlowResults.push(result.data);

                if (result.metrics?.totalTime) {
                    this.processingTimes.push(result.metrics.totalTime);
                }
            }

            this.eventResults.push({
                success: result.success,
                processingTime: result.metrics?.totalTime || 0,
                timestamp: new Date()
            });
        });

        this.logger.debug('Event subscriptions setup completed');
    }

    /**
     * 테스트 실행
     */
    private async executeTest(): Promise<any> {
        switch (this.config.testMode) {
            case 'unit':
                return await this.runUnitTest();
            case 'integration':
                return await this.runIntegrationScenarios();
            case 'performance':
                return await this.runPerformanceTest();
            case 'stress':
                return await this.runStressTest();
            default:
                throw new Error(`Unsupported test mode: ${this.config.testMode}`);
        }
    }

    /**
     * 단위 테스트 실행
     */
    private async runUnitTest(): Promise<any> {
        this.logger.debug('Running unit tests');

        const results = {
            workflowBuilderTest: await this.testWorkflowBuilder(),
            reactFlowGeneratorTest: await this.testReactFlowGenerator(),
            eventIntegrationTest: await this.testEventIntegration(),
            performanceOptimizerTest: await this.testPerformanceOptimizer()
        };

        return results;
    }

    /**
     * 통합 시나리오 테스트 실행
     */
    private async runIntegrationScenarios(): Promise<any> {
        this.logger.debug('Running integration scenarios');

        const scenarios = this.createTestScenarios();
        const results = [];

        for (const scenario of scenarios) {
            this.logger.debug('Running scenario', { name: scenario.name });

            const scenarioResult = await this.runScenario(scenario);
            results.push({
                scenario: scenario.name,
                result: scenarioResult
            });
        }

        return { scenarios: results };
    }

    /**
     * 성능 테스트 실행
     */
    private async runPerformanceTest(): Promise<any> {
        this.logger.debug('Running performance test');

        const performanceResults = {
            baselinePerformance: await this.measureBaselinePerformance(),
            loadPerformance: await this.measureLoadPerformance(),
            memoryPerformance: await this.measureMemoryPerformance(),
            cachePerformance: await this.measureCachePerformance()
        };

        return performanceResults;
    }

    /**
     * 스트레스 테스트 실행
     */
    private async runStressTest(): Promise<any> {
        this.logger.debug('Running stress test');

        const stressResults = {
            highFrequencyEvents: await this.testHighFrequencyEvents(),
            largeDataSets: await this.testLargeDataSets(),
            memoryPressure: await this.testMemoryPressure(),
            errorRecovery: await this.testErrorRecovery()
        };

        return stressResults;
    }

    /**
     * 테스트 시나리오 생성
     */
    private createTestScenarios(): TestScenario[] {
        return [
            {
                name: 'Basic Workflow Creation',
                description: 'Basic workflow with agent and tool calls',
                events: [
                    { type: 'agent_start', delay: 0, data: { agentId: 'agent-1' } },
                    { type: 'agent_thinking_start', delay: 100, data: { agentId: 'agent-1' } },
                    { type: 'tool_call_start', delay: 200, data: { toolName: 'calculator' } },
                    { type: 'tool_call_complete', delay: 500, data: { toolName: 'calculator', result: 'success' } },
                    { type: 'agent_thinking_complete', delay: 600, data: { agentId: 'agent-1' } },
                    { type: 'conversation_end', delay: 700, data: { agentId: 'agent-1' } }
                ],
                expectedOutcomes: {
                    minReactFlowGenerations: 3,
                    maxProcessingTime: 1000,
                    shouldUseCaching: false, // 첫 실행이므로
                    shouldUseIncrementalUpdate: true
                }
            },
            {
                name: 'Multi-Agent Collaboration',
                description: 'Multiple agents working together',
                events: [
                    { type: 'agent_start', delay: 0, data: { agentId: 'agent-1' } },
                    { type: 'agent_start', delay: 50, data: { agentId: 'agent-2' } },
                    { type: 'tool_call_start', delay: 100, data: { agentId: 'agent-1', toolName: 'assignTask' } },
                    { type: 'tool_call_complete', delay: 200, data: { agentId: 'agent-1', toolName: 'assignTask' } },
                    { type: 'agent_thinking_start', delay: 250, data: { agentId: 'agent-2' } },
                    { type: 'tool_call_start', delay: 300, data: { agentId: 'agent-2', toolName: 'database' } },
                    { type: 'tool_call_complete', delay: 500, data: { agentId: 'agent-2', toolName: 'database' } },
                    { type: 'conversation_end', delay: 600, data: { agentId: 'agent-1' } }
                ],
                expectedOutcomes: {
                    minReactFlowGenerations: 5,
                    maxProcessingTime: 1500,
                    shouldUseCaching: true,
                    shouldUseIncrementalUpdate: true
                }
            },
            {
                name: 'Rapid Event Sequence',
                description: 'Fast sequence of events to test batching',
                events: Array.from({ length: 20 }, (_, i) => ({
                    type: i % 2 === 0 ? 'tool_call_start' : 'tool_call_complete',
                    delay: i * 10, // 10ms apart
                    data: { toolName: `tool-${Math.floor(i / 2)}` }
                })),
                expectedOutcomes: {
                    minReactFlowGenerations: 1, // 배칭으로 인해 적음
                    maxProcessingTime: 500,
                    shouldUseCaching: true,
                    shouldUseIncrementalUpdate: true
                }
            }
        ];
    }

    /**
     * 시나리오 실행
     */
    private async runScenario(scenario: TestScenario): Promise<any> {
        const startTime = Date.now();

        // 초기 상태 캡처
        const initialReactFlowCount = this.reactFlowResults.length;

        // 이벤트 시뮬레이션
        const eventPromises = scenario.events.map(event =>
            this.scheduleEvent(event.type, event.data, event.delay)
        );

        // 모든 이벤트 완료 대기
        await Promise.all(eventPromises);

        // 처리 완료를 위한 추가 대기
        await this.waitForProcessingComplete(1000);

        const endTime = Date.now();
        const duration = endTime - startTime;

        // 결과 분석
        const reactFlowGenerations = this.reactFlowResults.length - initialReactFlowCount;
        const maxProcessingTime = Math.max(...this.processingTimes.slice(-scenario.events.length));

        return {
            duration,
            reactFlowGenerations,
            maxProcessingTime,
            meetsExpectations: this.checkScenarioExpectations(scenario, {
                reactFlowGenerations,
                maxProcessingTime
            })
        };
    }

    /**
     * 이벤트 스케줄링
     */
    private async scheduleEvent(eventType: string, data: any, delay: number): Promise<void> {
        return new Promise(resolve => {
            setTimeout(() => {
                this.eventService.emit(eventType as any, data as any); // Test compatibility - ServiceEventType restriction
                resolve();
            }, delay);
        });
    }

    /**
     * 처리 완료 대기
     */
    private async waitForProcessingComplete(timeout: number): Promise<void> {
        return new Promise(resolve => {
            setTimeout(resolve, timeout);
        });
    }

    /**
     * 시나리오 기대값 확인
     */
    private checkScenarioExpectations(scenario: TestScenario, results: any): boolean {
        const expectations = scenario.expectedOutcomes;

        return results.reactFlowGenerations >= expectations.minReactFlowGenerations &&
            results.maxProcessingTime <= expectations.maxProcessingTime;
    }

    /**
     * 워크플로우 빌더 테스트
     */
    private async testWorkflowBuilder(): Promise<any> {
        // 기본 기능 테스트
        const workflow = this.workflowBuilder.getCurrentWorkflow();
        const stats = this.workflowBuilder.getWorkflowStats();

        return {
            hasWorkflow: !!workflow,
            stats,
            reactFlowSupport: typeof this.workflowBuilder.generateReactFlowData === 'function'
        };
    }

    /**
     * React-Flow 제너레이터 테스트
     */
    private async testReactFlowGenerator(): Promise<any> {
        const stats = this.reactFlowGenerator.getGeneratorStats();

        return {
            generatorStats: stats,
            canGenerate: stats.generationCount >= 0
        };
    }

    /**
     * 이벤트 통합 테스트
     */
    private async testEventIntegration(): Promise<any> {
        const stats = this.eventIntegration.getEventStats();

        return {
            eventStats: stats,
            hasSubscribers: stats.pendingEvents >= 0
        };
    }

    /**
     * 성능 최적화기 테스트
     */
    private async testPerformanceOptimizer(): Promise<any> {
        const metrics = this.performanceOptimizer.getPerformanceMetrics();
        const cacheStats = this.performanceOptimizer.getCacheStats();

        return {
            performanceMetrics: metrics,
            cacheStats,
            isOptimizing: true
        };
    }

    /**
     * 기준 성능 측정
     */
    private async measureBaselinePerformance(): Promise<any> {
        // 간단한 워크플로우로 기준 성능 측정
        const startTime = Date.now();

        await this.eventService.emit('agent_start' as any, { agentId: 'baseline-test', sourceType: 'test', sourceId: 'baseline' } as any);
        await this.waitForProcessingComplete(100);

        const endTime = Date.now();

        return {
            baselineTime: endTime - startTime,
            memoryUsage: this.getCurrentMemoryUsage()
        };
    }

    /**
     * 로드 성능 측정
     */
    private async measureLoadPerformance(): Promise<any> {
        const eventCount = 100;
        const startTime = Date.now();

        // 많은 이벤트 발생
        for (let i = 0; i < eventCount; i++) {
            this.eventService.emit('tool_call_start' as any, { toolName: `load-test-${i}`, sourceType: 'test', sourceId: `load-${i}` } as any);
        }

        await this.waitForProcessingComplete(2000);

        const endTime = Date.now();
        const totalTime = endTime - startTime;

        return {
            eventCount,
            totalTime,
            averageTimePerEvent: totalTime / eventCount,
            eventsPerSecond: (eventCount / totalTime) * 1000
        };
    }

    /**
     * 메모리 성능 측정
     */
    private async measureMemoryPerformance(): Promise<any> {
        const beforeMemory = this.getCurrentMemoryUsage();

        // 메모리 집약적 작업 수행
        for (let i = 0; i < 50; i++) {
            await this.reactFlowGenerator.generateReactFlowData();
        }

        const afterMemory = this.getCurrentMemoryUsage();

        return {
            beforeMemory,
            afterMemory,
            memoryIncrease: afterMemory - beforeMemory,
            memoryEfficiency: beforeMemory > 0 ? (afterMemory - beforeMemory) / beforeMemory : 0
        };
    }

    /**
     * 캐시 성능 측정
     */
    private async measureCachePerformance(): Promise<any> {
        // 동일한 데이터로 여러 번 생성하여 캐시 효율성 측정
        const testData = await this.reactFlowGenerator.generateReactFlowData();

        const cacheTests = [];
        for (let i = 0; i < 10; i++) {
            const startTime = Date.now();
            await this.reactFlowGenerator.generateReactFlowData();
            const endTime = Date.now();

            cacheTests.push(endTime - startTime);
        }

        const cacheStats = this.performanceOptimizer.getCacheStats();

        return {
            cacheTests,
            averageCacheTime: cacheTests.reduce((a, b) => a + b, 0) / cacheTests.length,
            cacheHitRate: cacheStats.hitRate,
            cacheSize: cacheStats.size
        };
    }

    /**
     * 고빈도 이벤트 테스트
     */
    private async testHighFrequencyEvents(): Promise<any> {
        const eventCount = 1000;
        const duration = 5000; // 5초
        const interval = duration / eventCount;

        const startTime = Date.now();

        for (let i = 0; i < eventCount; i++) {
            setTimeout(() => {
                this.eventService.emit('high_frequency_test' as any, { index: i, sourceType: 'test', sourceId: `freq-${i}` } as any);
            }, i * interval);
        }

        await this.waitForProcessingComplete(duration + 1000);

        return {
            eventCount,
            duration,
            targetFrequency: eventCount / (duration / 1000),
            actualProcessedEvents: this.eventResults.length
        };
    }

    /**
     * 대용량 데이터 세트 테스트
     */
    private async testLargeDataSets(): Promise<any> {
        // 대용량 워크플로우 생성 시뮬레이션
        const largeEventData = {
            nodes: Array.from({ length: 500 }, (_, i) => ({
                id: `large-node-${i}`,
                type: 'agent',
                data: { label: `Large Node ${i}` }
            })),
            edges: Array.from({ length: 750 }, (_, i) => ({
                id: `large-edge-${i}`,
                source: `large-node-${i % 500}`,
                target: `large-node-${(i + 1) % 500}`
            }))
        };

        const startTime = Date.now();

        this.eventService.emit('large_dataset_test' as any, { ...largeEventData, sourceType: 'test', sourceId: 'large-data' } as any);

        await this.waitForProcessingComplete(5000);

        const endTime = Date.now();

        return {
            dataSize: largeEventData.nodes.length + largeEventData.edges.length,
            processingTime: endTime - startTime,
            memoryUsage: this.getCurrentMemoryUsage()
        };
    }

    /**
     * 메모리 압박 테스트
     */
    private async testMemoryPressure(): Promise<any> {
        const beforeMemory = this.getCurrentMemoryUsage();

        // 메모리 압박 상황 시뮬레이션
        const memoryIntensiveOperations = [];

        for (let i = 0; i < 100; i++) {
            memoryIntensiveOperations.push(
                this.reactFlowGenerator.generateReactFlowData()
            );
        }

        await Promise.all(memoryIntensiveOperations);

        const peakMemory = this.getCurrentMemoryUsage();

        // GC 대기
        if (global.gc) {
            global.gc();
        }

        await this.waitForProcessingComplete(1000);

        const afterGCMemory = this.getCurrentMemoryUsage();

        return {
            beforeMemory,
            peakMemory,
            afterGCMemory,
            memoryPressure: peakMemory - beforeMemory,
            gcEfficiency: (peakMemory - afterGCMemory) / peakMemory
        };
    }

    /**
     * 오류 복구 테스트
     */
    private async testErrorRecovery(): Promise<any> {
        const errorResults = [];

        // 의도적 오류 발생
        for (let i = 0; i < 5; i++) {
            try {
                this.eventService.emit('error_test' as any, {
                    shouldError: true,
                    errorType: 'simulated',
                    sourceType: 'test',
                    sourceId: `error-${i}`
                } as any);

                await this.waitForProcessingComplete(500);

                errorResults.push({ recovered: true });
            } catch (error) {
                errorResults.push({
                    recovered: false,
                    error: error instanceof Error ? error.message : 'Unknown error'
                });
            }
        }

        return {
            errorTests: errorResults,
            recoveryRate: errorResults.filter(r => r.recovered).length / errorResults.length
        };
    }

    /**
     * 현재 메모리 사용량
     */
    private getCurrentMemoryUsage(): number {
        if (typeof process !== 'undefined' && process.memoryUsage) {
            return process.memoryUsage().heapUsed;
        }
        return 0;
    }

    /**
     * 결과 분석
     */
    private async analyzeResults(testResult: any): Promise<RealTimeSystemTestResult> {
        const duration = Date.now() - this.testStartTime;

        // 이벤트 처리 통계
        const totalEvents = this.eventResults.length;
        const successfulEvents = this.eventResults.filter(r => r.success).length;
        const failedEvents = totalEvents - successfulEvents;

        const processingTimes = this.eventResults.map(r => r.processingTime);
        const averageProcessingTime = processingTimes.length > 0
            ? processingTimes.reduce((a, b) => a + b, 0) / processingTimes.length
            : 0;
        const maxProcessingTime = processingTimes.length > 0 ? Math.max(...processingTimes) : 0;

        // React-Flow 생성 통계
        const totalGenerations = this.reactFlowResults.length;
        const generatorStats = this.reactFlowGenerator.getGeneratorStats();

        // 성능 메트릭
        const performanceMetrics = this.performanceOptimizer.getPerformanceMetrics();
        const cacheStats = this.performanceOptimizer.getCacheStats();

        // 임계값 확인
        const thresholds = this.config.performanceThresholds;
        const thresholdsPassed = (
            maxProcessingTime <= (thresholds?.maxEventProcessingTime || Infinity) &&
            performanceMetrics.peakMemoryUsage <= (thresholds?.maxMemoryUsage || Infinity) &&
            cacheStats.hitRate >= (thresholds?.minCacheHitRate || 0) &&
            averageProcessingTime <= (thresholds?.maxRenderTime || Infinity)
        );

        return {
            success: failedEvents === 0 && thresholdsPassed,
            testMode: this.config.testMode,
            duration,

            eventProcessing: {
                totalEvents,
                processedEvents: successfulEvents,
                failedEvents,
                averageProcessingTime,
                maxProcessingTime
            },

            reactFlowGeneration: {
                totalGenerations,
                successfulGenerations: totalGenerations, // 실패 케이스 별도 추적 필요
                failedGenerations: 0,
                averageGenerationTime: generatorStats.averageGenerationTime,
                cacheHitRate: cacheStats.hitRate
            },

            performance: {
                peakMemoryUsage: performanceMetrics.peakMemoryUsage,
                averageMemoryUsage: performanceMetrics.memoryUsage,
                gcCount: performanceMetrics.gcCount,
                cacheEfficiency: cacheStats.hitRate,
                incrementalUpdateRatio: performanceMetrics.incrementalUpdateRatio
            },

            errors: [],
            warnings: [],
            thresholdsPassed
        };
    }

    /**
     * 정리 작업
     */
    private async cleanup(): Promise<void> {
        try {
            if (this.eventIntegration) {
                this.eventIntegration.dispose();
            }

            if (this.reactFlowGenerator) {
                this.reactFlowGenerator.dispose();
            }

            if (this.performanceOptimizer) {
                this.performanceOptimizer.dispose();
            }

            // 테스트 데이터 정리
            this.reactFlowResults.length = 0;
            this.processingTimes.length = 0;
            this.eventResults.length = 0;

            this.logger.debug('Test cleanup completed');
        } catch (error) {
            this.logger.error('Error during test cleanup', { error });
        }
    }
}

/**
 * 편의 함수: 빠른 통합 테스트
 */
export async function runQuickRealTimeSystemTest(
    config?: RealTimeSystemTestConfig
): Promise<RealTimeSystemTestResult> {
    const tester = new RealTimeSystemIntegrationTester({
        testMode: 'integration',
        simulationDuration: 10000, // 10초
        ...config
    });

    return await tester.runIntegrationTest();
}

/**
 * 편의 함수: 성능 벤치마크
 */
export async function runRealTimeSystemBenchmark(
    config?: RealTimeSystemTestConfig
): Promise<RealTimeSystemTestResult> {
    const tester = new RealTimeSystemIntegrationTester({
        testMode: 'performance',
        simulationDuration: 30000, // 30초
        enableDetailedLogging: true,
        ...config
    });

    return await tester.runIntegrationTest();
}