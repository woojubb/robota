/**
 * RealTimeReactFlowGenerator - 실시간 React-Flow 데이터 생성 시스템
 * 
 * Purpose: RealTimeMermaidGenerator와 병렬로 동작하는 React-Flow 전용 제너레이터
 * Architecture: Observer Pattern + Strategy Pattern으로 실시간 시각화 데이터 생성
 * Features: 실시간 스타일링, 애니메이션, 성능 최적화, 메트릭 수집
 */

import { EventService } from './event-service';
import { RealTimeWorkflowBuilder, WorkflowUpdate } from './real-time-workflow-builder';
import { UniversalToReactFlowConverter } from './react-flow';
import { ReactFlowLayoutEngine } from './react-flow/layout-engine';
import { ReactFlowMetadataMapper } from './react-flow/metadata-mapper';
import type { MetadataMappingConfig } from './react-flow/metadata-mapper';
import type {
    ReactFlowData,
    ReactFlowConverterConfig,
    ReactFlowLayoutConfig
} from './react-flow/types';
import type { SimpleLogger } from '../utils/simple-logger';
import { SilentLogger } from '../utils/simple-logger';
import type { GenericMetadata } from '../interfaces/base-types';

/**
 * Real-Time React-Flow Generator Configuration
 */
export interface RealTimeReactFlowConfig {
    // 변환 설정
    converter?: ReactFlowConverterConfig;

    // 레이아웃 설정
    layout?: ReactFlowLayoutConfig;

    // 메타데이터 매핑 설정
    metadata?: MetadataMappingConfig;

    // 성능 설정
    enableCaching?: boolean;
    cacheTimeout?: number; // milliseconds
    enableIncrementalUpdate?: boolean;

    // 애니메이션 설정
    enableRealTimeAnimation?: boolean;
    animationDuration?: number; // milliseconds

    // 스타일링 설정
    enableDynamicStyling?: boolean;
    themeUpdateInterval?: number; // milliseconds

    // 메트릭 수집
    enableMetrics?: boolean;
    metricsInterval?: number; // milliseconds
}

/**
 * Real-Time React-Flow Generation Result
 */
export interface RealTimeReactFlowResult {
    success: boolean;
    data?: ReactFlowData;
    error?: string;
    metrics?: ReactFlowGenerationMetrics;
    cached?: boolean;
}

/**
 * React-Flow Generation Metrics
 */
export interface ReactFlowGenerationMetrics {
    conversionTime: number;
    layoutTime: number;
    mappingTime: number;
    totalTime: number;
    nodeCount: number;
    edgeCount: number;
    cacheHit: boolean;
    memoryUsage?: number;
}

/**
 * React-Flow Cache Entry
 */
interface ReactFlowCacheEntry {
    data: ReactFlowData;
    timestamp: Date;
    workflowHash: string;
    metrics: ReactFlowGenerationMetrics;
}

/**
 * RealTimeReactFlowGenerator
 * 
 * Features:
 * - 실시간 React-Flow 데이터 생성
 * - Mermaid 제너레이터와 독립적 동작
 * - 스마트 캐싱 시스템
 * - 증분 업데이트 지원
 * - 실시간 애니메이션 및 스타일링
 * - 성능 메트릭 수집 및 모니터링
 */
export class RealTimeReactFlowGenerator {

    private readonly logger: SimpleLogger;
    private readonly config: Required<RealTimeReactFlowConfig>;
    private readonly eventService: EventService;
    private readonly workflowBuilder: RealTimeWorkflowBuilder;

    // Core components
    private readonly converter: UniversalToReactFlowConverter;
    private readonly layoutEngine: ReactFlowLayoutEngine;
    private readonly metadataMapper: ReactFlowMetadataMapper;

    // Caching system
    private readonly cache = new Map<string, ReactFlowCacheEntry>();
    private cacheCleanupInterval?: NodeJS.Timeout;

    // Performance tracking
    private readonly metrics: ReactFlowGenerationMetrics[] = [];
    private metricsInterval?: NodeJS.Timeout;

    // Real-time subscribers
    private readonly updateCallbacks: ((result: RealTimeReactFlowResult) => void)[] = [];

    // State tracking
    private lastWorkflowHash = '';
    private isGenerating = false;
    private generationCount = 0;

    constructor(
        eventService: EventService,
        workflowBuilder: RealTimeWorkflowBuilder,
        config: RealTimeReactFlowConfig = {},
        logger: SimpleLogger = SilentLogger
    ) {
        this.logger = logger;
        this.eventService = eventService;
        this.workflowBuilder = workflowBuilder;

        // 설정 기본값 적용
        this.config = {
            enableCaching: true,
            cacheTimeout: 30000, // 30초
            enableIncrementalUpdate: true,
            enableRealTimeAnimation: true,
            animationDuration: 300,
            enableDynamicStyling: true,
            themeUpdateInterval: 1000,
            enableMetrics: true,
            metricsInterval: 5000,
            ...config
        } as Required<RealTimeReactFlowConfig>;

        // 컴포넌트 초기화
        this.converter = new UniversalToReactFlowConverter(this.config.converter, this.logger);
        this.layoutEngine = new ReactFlowLayoutEngine(this.config.layout, this.logger);
        this.metadataMapper = new ReactFlowMetadataMapper(this.config.metadata, this.logger);

        this.setupWorkflowSubscription();
        this.setupCacheCleanup();
        this.setupMetricsCollection();

        this.logger.info('RealTimeReactFlowGenerator initialized', {
            config: this.config
        });
    }

    /**
     * React-Flow 업데이트 구독
     */
    subscribeToUpdates(callback: (result: RealTimeReactFlowResult) => void): void {
        this.updateCallbacks.push(callback);
        this.logger.debug('New React-Flow update subscriber registered');
    }

    /**
     * 현재 워크플로우에서 React-Flow 데이터 생성
     */
    async generateReactFlowData(): Promise<RealTimeReactFlowResult> {
        if (this.isGenerating) {
            this.logger.debug('Generation already in progress, skipping');
            return { success: false, error: 'Generation already in progress' };
        }

        this.isGenerating = true;
        const startTime = Date.now();

        try {
            this.logger.debug('Starting React-Flow data generation');

            // 1. 현재 워크플로우 가져오기
            const currentWorkflow = this.workflowBuilder.getCurrentWorkflow();
            const workflowHash = this.calculateWorkflowHash(currentWorkflow);

            // 2. 캐시 확인
            if (this.config.enableCaching) {
                const cachedResult = this.getCachedResult(workflowHash);
                if (cachedResult) {
                    this.logger.debug('Using cached React-Flow data');
                    return {
                        success: true,
                        data: cachedResult.data,
                        metrics: {
                            ...cachedResult.metrics,
                            cacheHit: true
                        },
                        cached: true
                    };
                }
            }

            // 3. React-Flow 데이터 생성
            const result = await this.performGeneration(currentWorkflow);
            const totalTime = Date.now() - startTime;

            // 4. 메트릭 업데이트
            const metrics: ReactFlowGenerationMetrics = {
                ...result.metrics!,
                totalTime,
                cacheHit: false
            };

            // 5. 캐시 저장
            if (this.config.enableCaching && result.success && result.data) {
                this.cacheResult(workflowHash, result.data, metrics);
            }

            // 6. 상태 업데이트
            this.lastWorkflowHash = workflowHash;
            this.generationCount++;

            const finalResult: RealTimeReactFlowResult = {
                success: result.success,
                data: result.data,
                error: result.error,
                metrics,
                cached: false
            };

            this.logger.info('React-Flow data generation completed', {
                success: result.success,
                nodeCount: result.data?.nodes.length || 0,
                edgeCount: result.data?.edges.length || 0,
                totalTime,
                cached: false
            });

            return finalResult;

        } catch (error) {
            this.logger.error('React-Flow data generation failed', { error });
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Unknown generation error'
            };
        } finally {
            this.isGenerating = false;
        }
    }

    /**
     * 실제 React-Flow 데이터 생성 로직
     */
    private async performGeneration(workflow: any): Promise<{
        success: boolean;
        data?: ReactFlowData;
        error?: string;
        metrics?: ReactFlowGenerationMetrics;
    }> {

        const startTime = Date.now();
        let conversionTime = 0;
        let layoutTime = 0;
        let mappingTime = 0;

        try {
            // 1. Universal 형식으로 변환 (이미 RealTimeWorkflowBuilder에서 처리됨)
            const reactFlowData = await this.workflowBuilder.generateReactFlowData();
            conversionTime = Date.now() - startTime;

            if (!reactFlowData) {
                return {
                    success: false,
                    error: 'Failed to generate React-Flow data from workflow builder'
                };
            }

            // 2. 레이아웃 적용
            const layoutStart = Date.now();
            const layoutOptions = {
                algorithm: this.config.layout?.algorithm || 'hierarchical',
                validateInput: false,
                validateOutput: false
            };

            const layoutResult = await this.layoutEngine.calculateLayout(reactFlowData, layoutOptions);
            layoutTime = Date.now() - layoutStart;

            if (!layoutResult.success || !layoutResult.data) {
                return {
                    success: false,
                    error: `Layout calculation failed: ${layoutResult.error}`
                };
            }

            // 3. 메타데이터 매핑 및 최종 처리
            const mappingStart = Date.now();
            const finalData = await this.applyFinalProcessing(layoutResult.data);
            mappingTime = Date.now() - mappingStart;

            const metrics: ReactFlowGenerationMetrics = {
                conversionTime,
                layoutTime,
                mappingTime,
                totalTime: Date.now() - startTime,
                nodeCount: finalData.nodes.length,
                edgeCount: finalData.edges.length,
                cacheHit: false
            };

            return {
                success: true,
                data: finalData,
                metrics
            };

        } catch (error) {
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Unknown generation error'
            };
        }
    }

    /**
     * 최종 처리 (스타일링, 애니메이션 등)
     */
    private async applyFinalProcessing(reactFlowData: ReactFlowData): Promise<ReactFlowData> {
        const processedData = { ...reactFlowData };

        // 1. 실시간 애니메이션 적용
        if (this.config.enableRealTimeAnimation) {
            processedData.edges = processedData.edges.map(edge => ({
                ...edge,
                animated: edge.type === 'robotaExecution' || edge.animated,
                style: {
                    ...edge.style,
                    transition: `all ${this.config.animationDuration}ms ease-in-out`
                }
            }));
        }

        // 2. 동적 스타일링 적용
        if (this.config.enableDynamicStyling) {
            processedData.nodes = processedData.nodes.map(node => ({
                ...node,
                style: {
                    ...node.style,
                    transition: `all ${this.config.animationDuration}ms ease-in-out`,
                    // 상태에 따른 동적 스타일링
                    borderColor: this.getNodeBorderColor(node.data?.status),
                    boxShadow: node.selected ? '0 0 10px rgba(0, 123, 255, 0.5)' : undefined
                }
            }));
        }

        // 3. 메타데이터 보강
        processedData.metadata = {
            ...processedData.metadata,
            generationTimestamp: new Date(),
            generatorVersion: '1.0.0',
            enabledFeatures: {
                realTimeAnimation: this.config.enableRealTimeAnimation,
                dynamicStyling: this.config.enableDynamicStyling,
                incrementalUpdate: this.config.enableIncrementalUpdate
            }
        };

        return processedData;
    }

    /**
     * 노드 상태에 따른 테두리 색상 결정
     */
    private getNodeBorderColor(status?: string): string {
        switch (status) {
            case 'running':
                return '#007bff'; // 파란색
            case 'completed':
                return '#28a745'; // 초록색
            case 'failed':
                return '#dc3545'; // 빨간색
            case 'pending':
                return '#ffc107'; // 노란색
            default:
                return '#6c757d'; // 회색
        }
    }

    /**
     * 워크플로우 업데이트 구독 설정
     */
    private setupWorkflowSubscription(): void {
        this.workflowBuilder.subscribeToWorkflowUpdates(async (update: WorkflowUpdate) => {
            this.logger.debug('Workflow update received, regenerating React-Flow data', {
                updateType: update.type
            });

            try {
                const result = await this.generateReactFlowData();
                this.notifySubscribers(result);
            } catch (error) {
                this.logger.error('Error handling workflow update', { error });
                this.notifySubscribers({
                    success: false,
                    error: error instanceof Error ? error.message : 'Unknown error'
                });
            }
        });
    }

    /**
     * 구독자들에게 업데이트 알림
     */
    private notifySubscribers(result: RealTimeReactFlowResult): void {
        this.updateCallbacks.forEach(callback => {
            try {
                callback(result);
            } catch (error) {
                this.logger.error('Error in React-Flow update callback', { error });
            }
        });
    }

    /**
     * 워크플로우 해시 계산
     */
    private calculateWorkflowHash(workflow: any): string {
        const hashData = {
            nodeCount: workflow.nodes?.length || 0,
            connectionCount: workflow.connections?.length || 0,
            lastUpdate: workflow.metadata?.startTime || new Date(),
            branchCount: workflow.branches?.length || 0
        };

        return Buffer.from(JSON.stringify(hashData)).toString('base64');
    }

    /**
     * 캐시에서 결과 가져오기
     */
    private getCachedResult(workflowHash: string): ReactFlowCacheEntry | null {
        const cached = this.cache.get(workflowHash);

        if (!cached) {
            return null;
        }

        // 캐시 만료 확인
        const now = Date.now();
        const cacheAge = now - cached.timestamp.getTime();

        if (cacheAge > this.config.cacheTimeout) {
            this.cache.delete(workflowHash);
            return null;
        }

        return cached;
    }

    /**
     * 결과 캐시에 저장
     */
    private cacheResult(
        workflowHash: string,
        data: ReactFlowData,
        metrics: ReactFlowGenerationMetrics
    ): void {
        this.cache.set(workflowHash, {
            data: { ...data }, // Deep copy to prevent mutations
            timestamp: new Date(),
            workflowHash,
            metrics
        });

        this.logger.debug('React-Flow data cached', { workflowHash });
    }

    /**
     * 캐시 정리 설정
     */
    private setupCacheCleanup(): void {
        if (!this.config.enableCaching) {
            return;
        }

        this.cacheCleanupInterval = setInterval(() => {
            const now = Date.now();
            let cleanedCount = 0;

            for (const [hash, entry] of this.cache.entries()) {
                const cacheAge = now - entry.timestamp.getTime();
                if (cacheAge > this.config.cacheTimeout) {
                    this.cache.delete(hash);
                    cleanedCount++;
                }
            }

            if (cleanedCount > 0) {
                this.logger.debug('Cache cleanup completed', {
                    cleanedEntries: cleanedCount,
                    remainingEntries: this.cache.size
                });
            }
        }, this.config.cacheTimeout / 2); // 캐시 타임아웃의 절반마다 정리
    }

    /**
     * 메트릭 수집 설정
     */
    private setupMetricsCollection(): void {
        if (!this.config.enableMetrics) {
            return;
        }

        this.metricsInterval = setInterval(() => {
            const stats = this.getGeneratorStats();
            this.logger.debug('React-Flow generator metrics', stats);
        }, this.config.metricsInterval);
    }

    /**
     * 제너레이터 통계 정보
     */
    getGeneratorStats(): {
        generationCount: number;
        cacheSize: number;
        cacheHitRate: number;
        averageGenerationTime: number;
        subscriberCount: number;
        isGenerating: boolean;
        lastWorkflowHash: string;
    } {
        const totalGenerations = this.metrics.length;
        const cacheHits = this.metrics.filter(m => m.cacheHit).length;
        const cacheHitRate = totalGenerations > 0 ? cacheHits / totalGenerations : 0;

        const avgTime = totalGenerations > 0
            ? this.metrics.reduce((sum, m) => sum + m.totalTime, 0) / totalGenerations
            : 0;

        return {
            generationCount: this.generationCount,
            cacheSize: this.cache.size,
            cacheHitRate,
            averageGenerationTime: avgTime,
            subscriberCount: this.updateCallbacks.length,
            isGenerating: this.isGenerating,
            lastWorkflowHash: this.lastWorkflowHash
        };
    }

    /**
     * 정리 작업
     */
    dispose(): void {
        if (this.cacheCleanupInterval) {
            clearInterval(this.cacheCleanupInterval);
        }

        if (this.metricsInterval) {
            clearInterval(this.metricsInterval);
        }

        this.cache.clear();
        this.updateCallbacks.length = 0;

        this.logger.info('RealTimeReactFlowGenerator disposed');
    }
}