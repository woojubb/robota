/**
 * Lazy Loading System for Tool Performance Optimization
 * 
 * @module lazy-loader
 * @description
 * 도구와 관련 리소스들을 필요할 때만 로딩하여 메모리 사용량과 초기 로딩 시간을 최적화합니다.
 */

import { CacheManager } from './cache-manager';

/**
 * 지연 로딩 가능한 리소스의 인터페이스
 */
export interface LazyLoadable<T> {
    /** 리소스 식별자 */
    id: string;
    /** 리소스를 로드하는 함수 */
    loader: () => Promise<T> | T;
    /** 리소스가 로드되었는지 여부 */
    isLoaded: boolean;
    /** 로드된 리소스 */
    resource?: T;
    /** 마지막 액세스 시간 */
    lastAccessed?: number;
    /** 로딩 우선순위 (낮을수록 높은 우선순위) */
    priority?: number;
}

/**
 * 지연 로딩 통계
 */
export interface LazyLoadStats {
    /** 총 등록된 리소스 수 */
    totalResources: number;
    /** 로드된 리소스 수 */
    loadedResources: number;
    /** 로드 성공 수 */
    loadSuccesses: number;
    /** 로드 실패 수 */
    loadFailures: number;
    /** 평균 로딩 시간 (밀리초) */
    averageLoadTime: number;
    /** 총 메모리 사용량 추정치 */
    estimatedMemoryUsage: number;
}

/**
 * 지연 로딩 매니저 클래스
 */
export class LazyLoader<T = any> {
    private resources: Map<string, LazyLoadable<T>> = new Map();
    private loadPromises: Map<string, Promise<T>> = new Map();
    private loadTimes: number[] = [];
    private loadSuccesses = 0;
    private loadFailures = 0;
    private cache?: CacheManager<T>;
    private maxConcurrentLoads: number;
    private currentLoads = 0;
    private loadQueue: Array<{ id: string; resolve: (value: T) => void; reject: (error: any) => void }> = [];

    constructor(options: {
        cache?: CacheManager<T>;
        maxConcurrentLoads?: number;
    } = {}) {
        this.cache = options.cache;
        this.maxConcurrentLoads = options.maxConcurrentLoads || 5;
    }

    /**
     * 지연 로딩 가능한 리소스 등록
     */
    register(resource: Omit<LazyLoadable<T>, 'isLoaded'>): void {
        this.resources.set(resource.id, {
            ...resource,
            isLoaded: false,
            lastAccessed: undefined
        });
    }

    /**
     * 여러 리소스를 한 번에 등록
     */
    registerMany(resources: Array<Omit<LazyLoadable<T>, 'isLoaded'>>): void {
        for (const resource of resources) {
            this.register(resource);
        }
    }

    /**
     * 리소스 로드 (비동기)
     */
    async load(id: string): Promise<T> {
        const resource = this.resources.get(id);
        if (!resource) {
            throw new Error(`리소스 '${id}'을(를) 찾을 수 없습니다.`);
        }

        // 이미 로드된 경우
        if (resource.isLoaded && resource.resource) {
            resource.lastAccessed = Date.now();
            return resource.resource;
        }

        // 캐시에서 확인
        if (this.cache) {
            const cached = this.cache.get(id);
            if (cached) {
                resource.resource = cached;
                resource.isLoaded = true;
                resource.lastAccessed = Date.now();
                return cached;
            }
        }

        // 현재 로딩 중인지 확인
        const existingPromise = this.loadPromises.get(id);
        if (existingPromise) {
            return existingPromise;
        }

        // 동시 로딩 제한 확인
        if (this.currentLoads >= this.maxConcurrentLoads) {
            return new Promise<T>((resolve, reject) => {
                this.loadQueue.push({ id, resolve, reject });
            });
        }

        // 실제 로딩 수행
        return this.performLoad(id, resource);
    }

    /**
     * 여러 리소스를 병렬로 로드
     */
    async loadMany(ids: string[]): Promise<T[]> {
        const promises = ids.map(id => this.load(id));
        return Promise.all(promises);
    }

    /**
     * 우선순위에 따라 리소스들을 미리 로드
     */
    async preload(maxCount?: number): Promise<void> {
        const unloaded = Array.from(this.resources.values())
            .filter(resource => !resource.isLoaded)
            .sort((a, b) => (a.priority || 999) - (b.priority || 999))
            .slice(0, maxCount);

        const promises = unloaded.map(resource => this.load(resource.id).catch(() => { }));
        await Promise.all(promises);
    }

    /**
     * 리소스 언로드 (메모리 정리)
     */
    unload(id: string): boolean {
        const resource = this.resources.get(id);
        if (!resource || !resource.isLoaded) {
            return false;
        }

        resource.resource = undefined;
        resource.isLoaded = false;
        resource.lastAccessed = undefined;

        // 캐시에서도 제거
        if (this.cache) {
            this.cache.delete(id);
        }

        return true;
    }

    /**
     * 오래된 리소스들을 언로드 (LRU 기반)
     */
    unloadOldest(count: number): number {
        const loaded = Array.from(this.resources.values())
            .filter(resource => resource.isLoaded && resource.lastAccessed)
            .sort((a, b) => (a.lastAccessed || 0) - (b.lastAccessed || 0))
            .slice(0, count);

        let unloadedCount = 0;
        for (const resource of loaded) {
            if (this.unload(resource.id)) {
                unloadedCount++;
            }
        }

        return unloadedCount;
    }

    /**
     * 모든 리소스 언로드
     */
    unloadAll(): void {
        for (const [id] of this.resources) {
            this.unload(id);
        }
        this.loadPromises.clear();
        this.loadQueue = [];
        this.currentLoads = 0;
    }

    /**
     * 리소스가 로드되어 있는지 확인
     */
    isLoaded(id: string): boolean {
        const resource = this.resources.get(id);
        return resource?.isLoaded || false;
    }

    /**
     * 등록된 모든 리소스 ID 목록
     */
    getResourceIds(): string[] {
        return Array.from(this.resources.keys());
    }

    /**
     * 로드된 리소스 ID 목록
     */
    getLoadedResourceIds(): string[] {
        return Array.from(this.resources.values())
            .filter(resource => resource.isLoaded)
            .map(resource => resource.id);
    }

    /**
     * 지연 로딩 통계
     */
    getStats(): LazyLoadStats {
        const totalResources = this.resources.size;
        const loadedResources = Array.from(this.resources.values())
            .filter(resource => resource.isLoaded).length;

        const averageLoadTime = this.loadTimes.length > 0
            ? this.loadTimes.reduce((sum, time) => sum + time, 0) / this.loadTimes.length
            : 0;

        // 메모리 사용량 추정
        let estimatedMemoryUsage = 0;
        for (const resource of this.resources.values()) {
            if (resource.isLoaded && resource.resource) {
                estimatedMemoryUsage += this.estimateResourceSize(resource.resource);
            }
        }

        return {
            totalResources,
            loadedResources,
            loadSuccesses: this.loadSuccesses,
            loadFailures: this.loadFailures,
            averageLoadTime,
            estimatedMemoryUsage
        };
    }

    /**
     * 실제 로딩 수행
     */
    private async performLoad(id: string, resource: LazyLoadable<T>): Promise<T> {
        const startTime = performance.now();
        this.currentLoads++;

        const promise = (async () => {
            try {
                const loaded = await Promise.resolve(resource.loader());

                // 리소스 업데이트
                resource.resource = loaded;
                resource.isLoaded = true;
                resource.lastAccessed = Date.now();

                // 캐시에 저장
                if (this.cache) {
                    this.cache.set(id, loaded);
                }

                const endTime = performance.now();
                const loadTime = endTime - startTime;
                this.loadTimes.push(loadTime);
                this.loadSuccesses++;

                return loaded;
            } catch (error) {
                this.loadFailures++;
                throw error;
            } finally {
                this.currentLoads--;
                this.loadPromises.delete(id);
                this.processQueue();
            }
        })();

        this.loadPromises.set(id, promise);
        return promise;
    }

    /**
     * 대기 중인 로딩 요청 처리
     */
    private processQueue(): void {
        while (this.loadQueue.length > 0 && this.currentLoads < this.maxConcurrentLoads) {
            const { id, resolve, reject } = this.loadQueue.shift()!;
            const resource = this.resources.get(id);

            if (resource) {
                this.performLoad(id, resource)
                    .then(resolve)
                    .catch(reject);
            } else {
                reject(new Error(`리소스 '${id}'을(를) 찾을 수 없습니다.`));
            }
        }
    }

    /**
     * 리소스 크기 추정
     */
    private estimateResourceSize(resource: any): number {
        if (resource === null || resource === undefined) {
            return 8;
        }

        switch (typeof resource) {
            case 'string':
                return resource.length * 2;
            case 'number':
                return 8;
            case 'boolean':
                return 4;
            case 'object':
                if (Array.isArray(resource)) {
                    return resource.reduce((acc, item) => acc + this.estimateResourceSize(item), 0);
                } else {
                    let size = 0;
                    for (const key in resource) {
                        size += key.length * 2;
                        size += this.estimateResourceSize(resource[key]);
                    }
                    return size;
                }
            default:
                return 16;
        }
    }
}

/**
 * 도구 전용 지연 로더
 */
export class ToolLazyLoader extends LazyLoader<any> {
    constructor() {
        super({
            cache: new CacheManager({
                maxSize: 100,
                defaultTTL: 60 * 60 * 1000 // 1시간
            }),
            maxConcurrentLoads: 3
        });
    }

    /**
     * 도구 정의에서 지연 로딩 리소스 생성
     */
    registerTool(toolId: string, toolDefinition: any, priority: number = 999): void {
        this.register({
            id: toolId,
            loader: () => {
                // 도구 정의를 실제 도구 인스턴스로 변환하는 로직
                return Promise.resolve(toolDefinition);
            },
            priority
        });
    }
}

/**
 * 전역 도구 지연 로더 인스턴스
 */
export const globalToolLazyLoader = new ToolLazyLoader(); 