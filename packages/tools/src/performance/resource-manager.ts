/**
 * Resource Manager for Memory Leak Prevention
 * 
 * @module resource-manager
 * @description
 * 메모리 누수를 방지하고 리소스 사용량을 모니터링하는 시스템을 제공합니다.
 */

import { CacheManager, CacheCleanupScheduler } from './cache-manager';
import { LazyLoader } from './lazy-loader';

/**
 * 리소스 타입 정의
 */
export type ResourceType = 'cache' | 'loader' | 'provider' | 'connection' | 'timer' | 'other';

/**
 * 리소스 정보 인터페이스
 */
export interface ResourceInfo {
    /** 리소스 식별자 */
    id: string;
    /** 리소스 타입 */
    type: ResourceType;
    /** 생성 시간 */
    createdAt: number;
    /** 마지막 사용 시간 */
    lastUsed: number;
    /** 정리 함수 */
    cleanup: () => Promise<void> | void;
    /** 메모리 사용량 추정치 */
    memoryUsage?: number;
    /** 설명 */
    description?: string;
}

/**
 * 메모리 사용량 정보
 */
export interface MemoryInfo {
    /** 힙 사용량 (바이트) */
    heapUsed: number;
    /** 힙 크기 (바이트) */
    heapTotal: number;
    /** 외부 메모리 (바이트) */
    external: number;
    /** RSS (Resident Set Size) */
    rss: number;
}

/**
 * 리소스 통계
 */
export interface ResourceStats {
    /** 총 리소스 수 */
    totalResources: number;
    /** 타입별 리소스 수 */
    byType: Record<ResourceType, number>;
    /** 가장 오래된 리소스의 나이 (밀리초) */
    oldestResourceAge: number;
    /** 평균 리소스 나이 (밀리초) */
    averageResourceAge: number;
    /** 총 메모리 사용량 추정치 */
    estimatedMemoryUsage: number;
    /** 시스템 메모리 정보 */
    systemMemory: MemoryInfo;
}

/**
 * 리소스 매니저 클래스
 */
export class ResourceManager {
    private resources: Map<string, ResourceInfo> = new Map();
    private cleanupInterval?: NodeJS.Timeout;
    private memoryCheckInterval?: NodeJS.Timeout;
    private maxAge: number; // 밀리초
    private maxMemoryUsage: number; // 바이트
    private isShuttingDown = false;

    constructor(options: {
        maxAge?: number; // 기본값: 1시간
        maxMemoryUsage?: number; // 기본값: 100MB
        cleanupIntervalMs?: number; // 기본값: 5분
        memoryCheckIntervalMs?: number; // 기본값: 30초
    } = {}) {
        this.maxAge = options.maxAge || 60 * 60 * 1000; // 1시간
        this.maxMemoryUsage = options.maxMemoryUsage || 100 * 1024 * 1024; // 100MB

        // 주기적 정리 작업 시작
        const cleanupIntervalMs = options.cleanupIntervalMs || 5 * 60 * 1000; // 5분
        this.cleanupInterval = setInterval(() => {
            this.performCleanup().catch(console.error);
        }, cleanupIntervalMs);

        // 메모리 체크 작업 시작
        const memoryCheckIntervalMs = options.memoryCheckIntervalMs || 30 * 1000; // 30초
        this.memoryCheckInterval = setInterval(() => {
            this.checkMemoryUsage().catch(console.error);
        }, memoryCheckIntervalMs);

        // 프로세스 종료 시 정리
        process.on('beforeExit', () => this.shutdown());
        process.on('SIGINT', () => this.shutdown());
        process.on('SIGTERM', () => this.shutdown());
    }

    /**
     * 리소스 등록
     */
    register(resourceInfo: Omit<ResourceInfo, 'createdAt' | 'lastUsed'>): void {
        if (this.isShuttingDown) {
            return;
        }

        const now = Date.now();
        const resource: ResourceInfo = {
            ...resourceInfo,
            createdAt: now,
            lastUsed: now
        };

        this.resources.set(resource.id, resource);
    }

    /**
     * 리소스 사용 기록 업데이트
     */
    markUsed(id: string): void {
        const resource = this.resources.get(id);
        if (resource) {
            resource.lastUsed = Date.now();
        }
    }

    /**
     * 리소스 정리
     */
    async cleanup(id: string): Promise<boolean> {
        const resource = this.resources.get(id);
        if (!resource) {
            return false;
        }

        try {
            await Promise.resolve(resource.cleanup());
            this.resources.delete(id);
            return true;
        } catch (error) {
            console.error(`리소스 '${id}' 정리 중 오류:`, error);
            return false;
        }
    }

    /**
     * 모든 리소스 정리
     */
    async cleanupAll(): Promise<number> {
        let cleanedCount = 0;
        const resources = Array.from(this.resources.keys());

        for (const id of resources) {
            if (await this.cleanup(id)) {
                cleanedCount++;
            }
        }

        return cleanedCount;
    }

    /**
     * 오래된 리소스들 정리
     */
    async cleanupOld(maxAge?: number): Promise<number> {
        const ageLimit = maxAge || this.maxAge;
        const now = Date.now();
        let cleanedCount = 0;

        for (const [id, resource] of this.resources.entries()) {
            const age = now - resource.lastUsed;
            if (age > ageLimit) {
                if (await this.cleanup(id)) {
                    cleanedCount++;
                }
            }
        }

        return cleanedCount;
    }

    /**
     * 메모리 사용량이 높은 리소스들 정리
     */
    async cleanupHighMemoryUsage(): Promise<number> {
        const resourcesWithMemory = Array.from(this.resources.entries())
            .filter(([, resource]) => resource.memoryUsage)
            .sort(([, a], [, b]) => (b.memoryUsage || 0) - (a.memoryUsage || 0));

        let cleanedCount = 0;
        let totalMemory = this.getTotalMemoryUsage();

        for (const [id, resource] of resourcesWithMemory) {
            if (totalMemory <= this.maxMemoryUsage) {
                break;
            }

            if (await this.cleanup(id)) {
                totalMemory -= resource.memoryUsage || 0;
                cleanedCount++;
            }
        }

        return cleanedCount;
    }

    /**
     * 리소스 존재 여부 확인
     */
    has(id: string): boolean {
        return this.resources.has(id);
    }

    /**
     * 등록된 모든 리소스 ID 목록
     */
    getResourceIds(): string[] {
        return Array.from(this.resources.keys());
    }

    /**
     * 특정 타입의 리소스 ID 목록
     */
    getResourceIdsByType(type: ResourceType): string[] {
        return Array.from(this.resources.values())
            .filter(resource => resource.type === type)
            .map(resource => resource.id);
    }

    /**
     * 리소스 통계
     */
    getStats(): ResourceStats {
        const now = Date.now();
        const resources = Array.from(this.resources.values());

        // 타입별 집계
        const byType: Record<ResourceType, number> = {
            cache: 0,
            loader: 0,
            provider: 0,
            connection: 0,
            timer: 0,
            other: 0
        };

        let oldestAge = 0;
        let totalAge = 0;
        let estimatedMemoryUsage = 0;

        for (const resource of resources) {
            byType[resource.type]++;

            const age = now - resource.createdAt;
            oldestAge = Math.max(oldestAge, age);
            totalAge += age;

            estimatedMemoryUsage += resource.memoryUsage || 0;
        }

        const averageAge = resources.length > 0 ? totalAge / resources.length : 0;

        return {
            totalResources: resources.length,
            byType,
            oldestResourceAge: oldestAge,
            averageResourceAge: averageAge,
            estimatedMemoryUsage,
            systemMemory: this.getSystemMemoryInfo()
        };
    }

    /**
     * 시스템 종료 시 정리
     */
    async shutdown(): Promise<void> {
        if (this.isShuttingDown) {
            return;
        }

        this.isShuttingDown = true;

        // 타이머 정리
        if (this.cleanupInterval) {
            clearInterval(this.cleanupInterval);
        }
        if (this.memoryCheckInterval) {
            clearInterval(this.memoryCheckInterval);
        }

        // 모든 리소스 정리
        await this.cleanupAll();
    }

    /**
     * 총 메모리 사용량 계산
     */
    private getTotalMemoryUsage(): number {
        return Array.from(this.resources.values())
            .reduce((total, resource) => total + (resource.memoryUsage || 0), 0);
    }

    /**
     * 주기적 정리 수행
     */
    private async performCleanup(): Promise<void> {
        try {
            const oldCleaned = await this.cleanupOld();
            if (oldCleaned > 0) {
                console.log(`리소스 정리: ${oldCleaned}개의 오래된 리소스를 정리했습니다.`);
            }
        } catch (error) {
            console.error('주기적 리소스 정리 중 오류:', error);
        }
    }

    /**
     * 메모리 사용량 체크
     */
    private async checkMemoryUsage(): Promise<void> {
        try {
            const totalMemory = this.getTotalMemoryUsage();
            if (totalMemory > this.maxMemoryUsage) {
                const cleaned = await this.cleanupHighMemoryUsage();
                console.warn(`메모리 사용량이 한계를 초과하여 ${cleaned}개의 리소스를 정리했습니다.`);
            }
        } catch (error) {
            console.error('메모리 사용량 체크 중 오류:', error);
        }
    }

    /**
     * 시스템 메모리 정보 조회
     */
    private getSystemMemoryInfo(): MemoryInfo {
        const memUsage = process.memoryUsage();
        return {
            heapUsed: memUsage.heapUsed,
            heapTotal: memUsage.heapTotal,
            external: memUsage.external,
            rss: memUsage.rss
        };
    }
}

/**
 * Tool Provider용 리소스 매니저
 */
export class ToolProviderResourceManager extends ResourceManager {
    constructor() {
        super({
            maxAge: 30 * 60 * 1000, // 30분
            maxMemoryUsage: 50 * 1024 * 1024, // 50MB
            cleanupIntervalMs: 3 * 60 * 1000, // 3분
            memoryCheckIntervalMs: 20 * 1000 // 20초
        });
    }

    /**
     * 캐시 매니저 등록
     */
    registerCache(id: string, cache: CacheManager, description?: string): void {
        this.register({
            id,
            type: 'cache',
            cleanup: () => cache.clear(),
            memoryUsage: cache.getStats().estimatedMemoryUsage,
            description: description || `캐시 매니저: ${id}`
        });
    }

    /**
     * 지연 로더 등록
     */
    registerLazyLoader(id: string, loader: LazyLoader, description?: string): void {
        this.register({
            id,
            type: 'loader',
            cleanup: () => loader.unloadAll(),
            memoryUsage: loader.getStats().estimatedMemoryUsage,
            description: description || `지연 로더: ${id}`
        });
    }

    /**
     * 정리 스케줄러 등록
     */
    registerCleanupScheduler(id: string, scheduler: CacheCleanupScheduler, description?: string): void {
        this.register({
            id,
            type: 'timer',
            cleanup: () => scheduler.stop(),
            description: description || `정리 스케줄러: ${id}`
        });
    }
}

/**
 * 전역 리소스 매니저 인스턴스
 */
export const globalResourceManager = new ToolProviderResourceManager(); 