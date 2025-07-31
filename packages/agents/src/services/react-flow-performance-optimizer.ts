/**
 * React-Flow Performance Optimizer
 * 
 * Purpose: 캐싱, 증분 업데이트, 메모리 관리를 통한 React-Flow 성능 최적화
 * Architecture: Strategy + Observer Pattern으로 성능 최적화 전략 적용
 * Features: 스마트 캐싱, 증분 업데이트, 메모리 관리, 성능 모니터링
 */

import type { SimpleLogger } from '../utils/simple-logger';
import { SilentLogger } from '../utils/simple-logger';
import type {
    ReactFlowData,
    ReactFlowNode,
    ReactFlowEdge
} from './react-flow/types';
import type { GenericMetadata } from '../interfaces/base-types';

/**
 * Performance Optimization Configuration
 */
export interface PerformanceOptimizerConfig {
    // 캐싱 설정
    enableCaching?: boolean;
    cacheSize?: number;
    cacheTTL?: number; // milliseconds

    // 증분 업데이트 설정
    enableIncrementalUpdate?: boolean;
    diffThreshold?: number; // 변경 임계값 (0-1)

    // 메모리 관리
    enableMemoryManagement?: boolean;
    maxMemoryUsage?: number; // bytes
    gcInterval?: number; // milliseconds

    // 성능 모니터링
    enablePerformanceMonitoring?: boolean;
    monitoringInterval?: number; // milliseconds

    // 최적화 전략
    optimizationStrategy?: 'conservative' | 'balanced' | 'aggressive';
}

/**
 * Performance Metrics
 */
export interface PerformanceMetrics {
    // 캐시 메트릭
    cacheHitRate: number;
    cacheSize: number;
    cacheMissCount: number;

    // 증분 업데이트 메트릭
    incrementalUpdateCount: number;
    fullUpdateCount: number;
    incrementalUpdateRatio: number;

    // 메모리 메트릭
    memoryUsage: number;
    peakMemoryUsage: number;
    gcCount: number;

    // 성능 메트릭
    averageRenderTime: number;
    averageDiffTime: number;
    totalOptimizationTime: number;
}

/**
 * Diff Result
 */
export interface DiffResult {
    hasChanges: boolean;
    changeRatio: number;
    addedNodes: ReactFlowNode[];
    removedNodes: ReactFlowNode[];
    modifiedNodes: ReactFlowNode[];
    addedEdges: ReactFlowEdge[];
    removedEdges: ReactFlowEdge[];
    modifiedEdges: ReactFlowEdge[];
}

/**
 * Cache Entry
 */
interface CacheEntry {
    data: ReactFlowData;
    timestamp: Date;
    hash: string;
    accessCount: number;
    lastAccessed: Date;
}

/**
 * Optimization Result
 */
export interface OptimizationResult {
    optimized: boolean;
    strategy: 'cache' | 'incremental' | 'full';
    data: ReactFlowData;
    metrics: {
        processingTime: number;
        memoryUsed: number;
        cacheHit?: boolean;
        incrementalChanges?: number;
    };
}

/**
 * ReactFlowPerformanceOptimizer
 * 
 * Features:
 * - 지능형 캐싱 시스템 (LRU + TTL)
 * - 효율적인 증분 업데이트
 * - 자동 메모리 관리
 * - 실시간 성능 모니터링
 * - 적응형 최적화 전략
 */
export class ReactFlowPerformanceOptimizer {

    private readonly logger: SimpleLogger;
    private readonly config: Required<PerformanceOptimizerConfig>;

    // 캐싱 시스템
    private readonly cache = new Map<string, CacheEntry>();
    private readonly cacheAccess = new Map<string, number>();

    // 증분 업데이트 추적
    private lastData: ReactFlowData | null = null;
    private lastDataHash = '';

    // 메모리 관리
    private memoryUsageHistory: number[] = [];
    private gcTimer?: NodeJS.Timeout;

    // 성능 메트릭
    private readonly metrics: PerformanceMetrics = {
        cacheHitRate: 0,
        cacheSize: 0,
        cacheMissCount: 0,
        incrementalUpdateCount: 0,
        fullUpdateCount: 0,
        incrementalUpdateRatio: 0,
        memoryUsage: 0,
        peakMemoryUsage: 0,
        gcCount: 0,
        averageRenderTime: 0,
        averageDiffTime: 0,
        totalOptimizationTime: 0
    };

    // 성능 추적
    private renderTimes: number[] = [];
    private diffTimes: number[] = [];
    private monitoringTimer?: NodeJS.Timeout;

    constructor(
        config: PerformanceOptimizerConfig = {},
        logger: SimpleLogger = SilentLogger
    ) {
        this.logger = logger;

        // 설정 기본값 적용
        this.config = {
            enableCaching: true,
            cacheSize: 100,
            cacheTTL: 300000, // 5분
            enableIncrementalUpdate: true,
            diffThreshold: 0.1, // 10% 변경 시 증분 업데이트
            enableMemoryManagement: true,
            maxMemoryUsage: 100 * 1024 * 1024, // 100MB
            gcInterval: 60000, // 1분
            enablePerformanceMonitoring: true,
            monitoringInterval: 10000, // 10초
            optimizationStrategy: 'balanced',
            ...config
        } as Required<PerformanceOptimizerConfig>;

        this.setupMemoryManagement();
        this.setupPerformanceMonitoring();

        this.logger.info('ReactFlowPerformanceOptimizer initialized', {
            config: this.config
        });
    }

    /**
     * React-Flow 데이터 최적화
     */
    async optimizeReactFlowData(
        newData: ReactFlowData,
        context?: { forceUpdate?: boolean; skipCache?: boolean }
    ): Promise<OptimizationResult> {

        const startTime = Date.now();
        const memoryBefore = this.getCurrentMemoryUsage();

        try {
            // 1. 캐시 확인 (강제 업데이트가 아닌 경우)
            if (!context?.forceUpdate && !context?.skipCache && this.config.enableCaching) {
                const cacheResult = this.checkCache(newData);
                if (cacheResult) {
                    const processingTime = Date.now() - startTime;

                    this.updateMetrics('cache', processingTime, 0, true);

                    return {
                        optimized: true,
                        strategy: 'cache',
                        data: cacheResult.data,
                        metrics: {
                            processingTime,
                            memoryUsed: 0,
                            cacheHit: true
                        }
                    };
                }
            }

            // 2. 증분 업데이트 시도
            if (this.config.enableIncrementalUpdate && this.lastData) {
                const diffResult = await this.calculateDiff(this.lastData, newData);

                if (diffResult.hasChanges && diffResult.changeRatio <= this.config.diffThreshold) {
                    const optimizedData = await this.applyIncrementalUpdate(this.lastData, diffResult);
                    const processingTime = Date.now() - startTime;
                    const memoryUsed = this.getCurrentMemoryUsage() - memoryBefore;

                    this.updateMetrics('incremental', processingTime, memoryUsed, false, diffResult.changeRatio);
                    this.cacheData(optimizedData);
                    this.lastData = optimizedData;

                    return {
                        optimized: true,
                        strategy: 'incremental',
                        data: optimizedData,
                        metrics: {
                            processingTime,
                            memoryUsed,
                            incrementalChanges: this.countChanges(diffResult)
                        }
                    };
                }
            }

            // 3. 전체 업데이트
            const optimizedData = await this.performFullUpdate(newData);
            const processingTime = Date.now() - startTime;
            const memoryUsed = this.getCurrentMemoryUsage() - memoryBefore;

            this.updateMetrics('full', processingTime, memoryUsed, false);
            this.cacheData(optimizedData);
            this.lastData = optimizedData;

            return {
                optimized: true,
                strategy: 'full',
                data: optimizedData,
                metrics: {
                    processingTime,
                    memoryUsed
                }
            };

        } catch (error) {
            this.logger.error('Optimization failed', { error });

            return {
                optimized: false,
                strategy: 'full',
                data: newData,
                metrics: {
                    processingTime: Date.now() - startTime,
                    memoryUsed: this.getCurrentMemoryUsage() - memoryBefore
                }
            };
        }
    }

    /**
     * 캐시 확인
     */
    private checkCache(data: ReactFlowData): CacheEntry | null {
        const hash = this.calculateHash(data);
        const cached = this.cache.get(hash);

        if (!cached) {
            this.metrics.cacheMissCount++;
            return null;
        }

        // TTL 확인
        const now = Date.now();
        const age = now - cached.timestamp.getTime();

        if (age > this.config.cacheTTL) {
            this.cache.delete(hash);
            this.metrics.cacheMissCount++;
            return null;
        }

        // 액세스 정보 업데이트
        cached.accessCount++;
        cached.lastAccessed = new Date();
        this.cacheAccess.set(hash, cached.accessCount);

        this.logger.debug('Cache hit', { hash, age, accessCount: cached.accessCount });

        return cached;
    }

    /**
     * 데이터 캐시
     */
    private cacheData(data: ReactFlowData): void {
        if (!this.config.enableCaching) {
            return;
        }

        const hash = this.calculateHash(data);

        // 캐시 크기 관리
        if (this.cache.size >= this.config.cacheSize) {
            this.evictLRU();
        }

        // 새 항목 추가
        this.cache.set(hash, {
            data: this.deepCopy(data),
            timestamp: new Date(),
            hash,
            accessCount: 1,
            lastAccessed: new Date()
        });

        this.cacheAccess.set(hash, 1);
        this.metrics.cacheSize = this.cache.size;

        this.logger.debug('Data cached', { hash, cacheSize: this.cache.size });
    }

    /**
     * LRU 캐시 제거
     */
    private evictLRU(): void {
        let lruHash = '';
        let lruAccessCount = Infinity;
        let oldestAccess = new Date();

        for (const [hash, entry] of this.cache.entries()) {
            if (entry.accessCount < lruAccessCount ||
                (entry.accessCount === lruAccessCount && entry.lastAccessed < oldestAccess)) {
                lruHash = hash;
                lruAccessCount = entry.accessCount;
                oldestAccess = entry.lastAccessed;
            }
        }

        if (lruHash) {
            this.cache.delete(lruHash);
            this.cacheAccess.delete(lruHash);
            this.logger.debug('LRU cache entry evicted', { hash: lruHash });
        }
    }

    /**
     * 데이터 변경 계산
     */
    private async calculateDiff(oldData: ReactFlowData, newData: ReactFlowData): Promise<DiffResult> {
        const startTime = Date.now();

        try {
            // 노드 차이 계산
            const oldNodes = new Map(oldData.nodes.map(n => [n.id, n]));
            const newNodes = new Map(newData.nodes.map(n => [n.id, n]));

            const addedNodes: ReactFlowNode[] = [];
            const removedNodes: ReactFlowNode[] = [];
            const modifiedNodes: ReactFlowNode[] = [];

            // 새로 추가된 노드
            for (const [id, node] of newNodes) {
                if (!oldNodes.has(id)) {
                    addedNodes.push(node);
                }
            }

            // 제거된 노드
            for (const [id, node] of oldNodes) {
                if (!newNodes.has(id)) {
                    removedNodes.push(node);
                }
            }

            // 수정된 노드
            for (const [id, newNode] of newNodes) {
                const oldNode = oldNodes.get(id);
                if (oldNode && !this.areNodesEqual(oldNode, newNode)) {
                    modifiedNodes.push(newNode);
                }
            }

            // 엣지 차이 계산
            const oldEdges = new Map(oldData.edges.map(e => [e.id, e]));
            const newEdges = new Map(newData.edges.map(e => [e.id, e]));

            const addedEdges: ReactFlowEdge[] = [];
            const removedEdges: ReactFlowEdge[] = [];
            const modifiedEdges: ReactFlowEdge[] = [];

            // 새로 추가된 엣지
            for (const [id, edge] of newEdges) {
                if (!oldEdges.has(id)) {
                    addedEdges.push(edge);
                }
            }

            // 제거된 엣지
            for (const [id, edge] of oldEdges) {
                if (!newEdges.has(id)) {
                    removedEdges.push(edge);
                }
            }

            // 수정된 엣지
            for (const [id, newEdge] of newEdges) {
                const oldEdge = oldEdges.get(id);
                if (oldEdge && !this.areEdgesEqual(oldEdge, newEdge)) {
                    modifiedEdges.push(newEdge);
                }
            }

            // 변경 비율 계산
            const totalOldItems = oldData.nodes.length + oldData.edges.length;
            const totalChanges = addedNodes.length + removedNodes.length + modifiedNodes.length +
                addedEdges.length + removedEdges.length + modifiedEdges.length;

            const changeRatio = totalOldItems > 0 ? totalChanges / totalOldItems : 1;
            const hasChanges = totalChanges > 0;

            const diffTime = Date.now() - startTime;
            this.diffTimes.push(diffTime);
            this.updateAverageDiffTime();

            return {
                hasChanges,
                changeRatio,
                addedNodes,
                removedNodes,
                modifiedNodes,
                addedEdges,
                removedEdges,
                modifiedEdges
            };

        } catch (error) {
            this.logger.error('Diff calculation failed', { error });

            // 오류 시 전체 변경으로 처리
            return {
                hasChanges: true,
                changeRatio: 1,
                addedNodes: newData.nodes,
                removedNodes: [],
                modifiedNodes: [],
                addedEdges: newData.edges,
                removedEdges: [],
                modifiedEdges: []
            };
        }
    }

    /**
     * 증분 업데이트 적용
     */
    private async applyIncrementalUpdate(
        baseData: ReactFlowData,
        diff: DiffResult
    ): Promise<ReactFlowData> {

        const updatedData = this.deepCopy(baseData);

        // 노드 업데이트
        const nodeMap = new Map(updatedData.nodes.map(n => [n.id, n]));

        // 제거된 노드
        diff.removedNodes.forEach(node => {
            nodeMap.delete(node.id);
        });

        // 추가된 노드
        diff.addedNodes.forEach(node => {
            nodeMap.set(node.id, node);
        });

        // 수정된 노드
        diff.modifiedNodes.forEach(node => {
            nodeMap.set(node.id, node);
        });

        updatedData.nodes = Array.from(nodeMap.values());

        // 엣지 업데이트
        const edgeMap = new Map(updatedData.edges.map(e => [e.id, e]));

        // 제거된 엣지
        diff.removedEdges.forEach(edge => {
            edgeMap.delete(edge.id);
        });

        // 추가된 엣지
        diff.addedEdges.forEach(edge => {
            edgeMap.set(edge.id, edge);
        });

        // 수정된 엣지
        diff.modifiedEdges.forEach(edge => {
            edgeMap.set(edge.id, edge);
        });

        updatedData.edges = Array.from(edgeMap.values());

        // 메타데이터 업데이트
        updatedData.metadata = {
            ...updatedData.metadata,
            lastIncrementalUpdate: new Date(),
            incrementalChanges: this.countChanges(diff)
        };

        this.metrics.incrementalUpdateCount++;
        this.updateIncrementalUpdateRatio();

        return updatedData;
    }

    /**
     * 전체 업데이트 수행
     */
    private async performFullUpdate(data: ReactFlowData): Promise<ReactFlowData> {
        // 전체 업데이트 시 최적화 전략 적용
        const optimizedData = this.deepCopy(data);

        // 최적화 전략에 따른 처리
        switch (this.config.optimizationStrategy) {
            case 'aggressive':
                // 공격적 최적화: 불필요한 속성 제거, 압축 등
                await this.applyAggressiveOptimization(optimizedData);
                break;
            case 'balanced':
                // 균형 최적화: 적당한 최적화 적용
                await this.applyBalancedOptimization(optimizedData);
                break;
            case 'conservative':
                // 보수적 최적화: 최소한의 최적화만 적용
                await this.applyConservativeOptimization(optimizedData);
                break;
        }

        // 메타데이터 업데이트
        optimizedData.metadata = {
            ...optimizedData.metadata,
            lastFullUpdate: new Date(),
            optimizationStrategy: this.config.optimizationStrategy
        };

        this.metrics.fullUpdateCount++;
        this.updateIncrementalUpdateRatio();

        return optimizedData;
    }

    /**
     * 공격적 최적화 적용
     */
    private async applyAggressiveOptimization(data: ReactFlowData): Promise<void> {
        // 불필요한 속성 제거
        data.nodes.forEach(node => {
            // 기본값과 같은 속성 제거
            if (node.draggable === true) delete node.draggable;
            if (node.selectable === true) delete node.selectable;
            if (node.hidden === false) delete node.hidden;
        });

        data.edges.forEach(edge => {
            // 기본값과 같은 속성 제거
            if (edge.animated === false) delete edge.animated;
            if (edge.hidden === false) delete edge.hidden;
        });
    }

    /**
     * 균형 최적화 적용
     */
    private async applyBalancedOptimization(data: ReactFlowData): Promise<void> {
        // 중간 정도의 최적화
        data.nodes.forEach(node => {
            // 성능에 영향이 적은 기본값 제거
            if (node.hidden === false) delete node.hidden;
        });
    }

    /**
     * 보수적 최적화 적용
     */
    private async applyConservativeOptimization(data: ReactFlowData): Promise<void> {
        // 최소한의 최적화만 적용
        // 메타데이터만 정리
        if (data.metadata) {
            // 불필요한 메타데이터 정리
        }
    }

    /**
     * 노드 동등성 확인
     */
    private areNodesEqual(node1: ReactFlowNode, node2: ReactFlowNode): boolean {
        return JSON.stringify(node1) === JSON.stringify(node2);
    }

    /**
     * 엣지 동등성 확인
     */
    private areEdgesEqual(edge1: ReactFlowEdge, edge2: ReactFlowEdge): boolean {
        return JSON.stringify(edge1) === JSON.stringify(edge2);
    }

    /**
     * 변경사항 수 계산
     */
    private countChanges(diff: DiffResult): number {
        return diff.addedNodes.length + diff.removedNodes.length + diff.modifiedNodes.length +
            diff.addedEdges.length + diff.removedEdges.length + diff.modifiedEdges.length;
    }

    /**
     * 해시 계산
     */
    private calculateHash(data: ReactFlowData): string {
        const hashData = {
            nodeCount: data.nodes.length,
            edgeCount: data.edges.length,
            nodes: data.nodes.map(n => ({ id: n.id, type: n.type, position: n.position })),
            edges: data.edges.map(e => ({ id: e.id, source: e.source, target: e.target }))
        };

        return Buffer.from(JSON.stringify(hashData)).toString('base64');
    }

    /**
     * 깊은 복사
     */
    private deepCopy<T>(obj: T): T {
        return JSON.parse(JSON.stringify(obj));
    }

    /**
     * 현재 메모리 사용량 가져오기
     */
    private getCurrentMemoryUsage(): number {
        if (typeof process !== 'undefined' && process.memoryUsage) {
            return process.memoryUsage().heapUsed;
        }
        return 0;
    }

    /**
     * 메트릭 업데이트
     */
    private updateMetrics(
        strategy: 'cache' | 'incremental' | 'full',
        processingTime: number,
        memoryUsed: number,
        cacheHit: boolean,
        changeRatio?: number
    ): void {
        // 렌더링 시간 업데이트
        this.renderTimes.push(processingTime);
        this.updateAverageRenderTime();

        // 메모리 사용량 업데이트
        const currentMemory = this.getCurrentMemoryUsage();
        this.metrics.memoryUsage = currentMemory;
        this.metrics.peakMemoryUsage = Math.max(this.metrics.peakMemoryUsage, currentMemory);
        this.memoryUsageHistory.push(currentMemory);

        // 캐시 히트율 업데이트
        if (cacheHit) {
            const totalCacheRequests = this.cache.size + this.metrics.cacheMissCount;
            this.metrics.cacheHitRate = totalCacheRequests > 0 ? this.cache.size / totalCacheRequests : 0;
        }

        // 총 최적화 시간 업데이트
        this.metrics.totalOptimizationTime += processingTime;
    }

    /**
     * 평균 렌더링 시간 업데이트
     */
    private updateAverageRenderTime(): void {
        if (this.renderTimes.length > 100) {
            this.renderTimes = this.renderTimes.slice(-50); // 최근 50개만 유지
        }

        const total = this.renderTimes.reduce((sum, time) => sum + time, 0);
        this.metrics.averageRenderTime = total / this.renderTimes.length;
    }

    /**
     * 평균 Diff 시간 업데이트
     */
    private updateAverageDiffTime(): void {
        if (this.diffTimes.length > 100) {
            this.diffTimes = this.diffTimes.slice(-50); // 최근 50개만 유지
        }

        const total = this.diffTimes.reduce((sum, time) => sum + time, 0);
        this.metrics.averageDiffTime = total / this.diffTimes.length;
    }

    /**
     * 증분 업데이트 비율 업데이트
     */
    private updateIncrementalUpdateRatio(): void {
        const total = this.metrics.incrementalUpdateCount + this.metrics.fullUpdateCount;
        this.metrics.incrementalUpdateRatio = total > 0 ? this.metrics.incrementalUpdateCount / total : 0;
    }

    /**
     * 메모리 관리 설정
     */
    private setupMemoryManagement(): void {
        if (!this.config.enableMemoryManagement) {
            return;
        }

        this.gcTimer = setInterval(() => {
            this.performGarbageCollection();
        }, this.config.gcInterval);
    }

    /**
     * 가비지 컬렉션 수행
     */
    private performGarbageCollection(): void {
        const beforeMemory = this.getCurrentMemoryUsage();

        // 캐시 정리
        if (this.cache.size > this.config.cacheSize * 0.8) {
            const entriesToRemove = Math.floor(this.config.cacheSize * 0.2);
            const sortedEntries = Array.from(this.cache.entries())
                .sort((a, b) => a[1].lastAccessed.getTime() - b[1].lastAccessed.getTime());

            for (let i = 0; i < entriesToRemove && i < sortedEntries.length; i++) {
                this.cache.delete(sortedEntries[i][0]);
                this.cacheAccess.delete(sortedEntries[i][0]);
            }
        }

        // 메모리 이력 정리
        if (this.memoryUsageHistory.length > 1000) {
            this.memoryUsageHistory = this.memoryUsageHistory.slice(-500);
        }

        // 성능 이력 정리
        if (this.renderTimes.length > 200) {
            this.renderTimes = this.renderTimes.slice(-100);
        }

        if (this.diffTimes.length > 200) {
            this.diffTimes = this.diffTimes.slice(-100);
        }

        const afterMemory = this.getCurrentMemoryUsage();
        const memoryFreed = beforeMemory - afterMemory;

        if (memoryFreed > 0) {
            this.metrics.gcCount++;
            this.logger.debug('Garbage collection completed', {
                memoryFreed,
                cacheSize: this.cache.size
            });
        }
    }

    /**
     * 성능 모니터링 설정
     */
    private setupPerformanceMonitoring(): void {
        if (!this.config.enablePerformanceMonitoring) {
            return;
        }

        this.monitoringTimer = setInterval(() => {
            this.logPerformanceMetrics();
        }, this.config.monitoringInterval);
    }

    /**
     * 성능 메트릭 로깅
     */
    private logPerformanceMetrics(): void {
        this.logger.debug('Performance metrics', {
            ...this.metrics,
            cacheSize: this.cache.size,
            memoryUsageHistory: this.memoryUsageHistory.slice(-5) // 최근 5개만
        });
    }

    /**
     * 성능 메트릭 가져오기
     */
    getPerformanceMetrics(): PerformanceMetrics {
        return { ...this.metrics };
    }

    /**
     * 캐시 상태 가져오기
     */
    getCacheStats(): {
        size: number;
        maxSize: number;
        hitRate: number;
        entries: Array<{ hash: string; accessCount: number; age: number }>;
    } {
        const now = Date.now();
        const entries = Array.from(this.cache.entries()).map(([hash, entry]) => ({
            hash,
            accessCount: entry.accessCount,
            age: now - entry.timestamp.getTime()
        }));

        return {
            size: this.cache.size,
            maxSize: this.config.cacheSize,
            hitRate: this.metrics.cacheHitRate,
            entries
        };
    }

    /**
     * 캐시 비우기
     */
    clearCache(): void {
        this.cache.clear();
        this.cacheAccess.clear();
        this.metrics.cacheSize = 0;
        this.logger.debug('Cache cleared');
    }

    /**
     * 설정 업데이트
     */
    updateConfig(newConfig: Partial<PerformanceOptimizerConfig>): void {
        Object.assign(this.config, newConfig);
        this.logger.debug('Performance optimizer configuration updated', { newConfig });
    }

    /**
     * 정리 작업
     */
    dispose(): void {
        if (this.gcTimer) {
            clearInterval(this.gcTimer);
        }

        if (this.monitoringTimer) {
            clearInterval(this.monitoringTimer);
        }

        this.clearCache();
        this.memoryUsageHistory.length = 0;
        this.renderTimes.length = 0;
        this.diffTimes.length = 0;

        this.logger.info('ReactFlowPerformanceOptimizer disposed');
    }
}