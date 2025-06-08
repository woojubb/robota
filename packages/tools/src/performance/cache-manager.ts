/**
 * Cache Manager for Tool Performance Optimization
 * 
 * @module cache-manager
 * @description
 * 도구 로딩 및 함수 스키마 변환 결과를 캐싱하여 성능을 최적화합니다.
 */

import type { FunctionSchema } from '../types';

/**
 * 캐시 항목 인터페이스
 */
export interface CacheItem<T> {
    /** 캐시된 데이터 */
    data: T;
    /** 캐시 생성 시간 */
    timestamp: number;
    /** 만료 시간 (밀리초) */
    ttl?: number;
    /** 액세스 횟수 */
    accessCount: number;
    /** 마지막 액세스 시간 */
    lastAccessed: number;
}

/**
 * 캐시 통계 정보
 */
export interface CacheStats {
    /** 총 캐시 항목 수 */
    totalItems: number;
    /** 캐시 히트 수 */
    hits: number;
    /** 캐시 미스 수 */
    misses: number;
    /** 히트율 (0-1) */
    hitRate: number;
    /** 만료된 항목 수 */
    expired: number;
    /** 메모리 사용량 (추정치) */
    estimatedMemoryUsage: number;
}

/**
 * 캐시 매니저 클래스
 * 
 * LRU (Least Recently Used) 알고리즘과 TTL (Time To Live)을 지원합니다.
 */
export class CacheManager<T = any> {
    private cache: Map<string, CacheItem<T>> = new Map();
    private maxSize: number;
    private defaultTTL?: number;
    private hits = 0;
    private misses = 0;
    private expired = 0;

    constructor(options: {
        maxSize?: number;
        defaultTTL?: number; // 밀리초 단위
    } = {}) {
        this.maxSize = options.maxSize || 1000;
        this.defaultTTL = options.defaultTTL;
    }

    /**
     * 캐시에서 값 조회
     */
    get(key: string): T | undefined {
        const item = this.cache.get(key);

        if (!item) {
            this.misses++;
            return undefined;
        }

        // TTL 확인
        if (this.isExpired(item)) {
            this.cache.delete(key);
            this.expired++;
            this.misses++;
            return undefined;
        }

        // 액세스 정보 업데이트
        item.accessCount++;
        item.lastAccessed = Date.now();
        this.hits++;

        return item.data;
    }

    /**
     * 캐시에 값 저장
     */
    set(key: string, value: T, ttl?: number): void {
        // 캐시 크기 제한 확인
        if (this.cache.size >= this.maxSize && !this.cache.has(key)) {
            this.evictLRU();
        }

        const now = Date.now();
        const item: CacheItem<T> = {
            data: value,
            timestamp: now,
            ttl: ttl || this.defaultTTL,
            accessCount: 1,
            lastAccessed: now
        };

        this.cache.set(key, item);
    }

    /**
     * 캐시에서 항목 삭제
     */
    delete(key: string): boolean {
        return this.cache.delete(key);
    }

    /**
     * 특정 키가 캐시에 있는지 확인
     */
    has(key: string): boolean {
        const item = this.cache.get(key);
        if (!item) return false;

        if (this.isExpired(item)) {
            this.cache.delete(key);
            this.expired++;
            return false;
        }

        return true;
    }

    /**
     * 캐시 전체 삭제
     */
    clear(): void {
        this.cache.clear();
        this.hits = 0;
        this.misses = 0;
        this.expired = 0;
    }

    /**
     * 만료된 항목들 정리
     */
    cleanup(): number {
        let cleanedCount = 0;
        const now = Date.now();

        for (const [key, item] of this.cache.entries()) {
            if (this.isExpired(item, now)) {
                this.cache.delete(key);
                cleanedCount++;
                this.expired++;
            }
        }

        return cleanedCount;
    }

    /**
     * 캐시 통계 반환
     */
    getStats(): CacheStats {
        const totalRequests = this.hits + this.misses;
        const hitRate = totalRequests > 0 ? this.hits / totalRequests : 0;

        // 메모리 사용량 추정 (키 + 데이터의 대략적인 크기)
        let estimatedMemoryUsage = 0;
        for (const [key, item] of this.cache.entries()) {
            estimatedMemoryUsage += key.length * 2; // UTF-16 문자
            estimatedMemoryUsage += this.estimateObjectSize(item);
        }

        return {
            totalItems: this.cache.size,
            hits: this.hits,
            misses: this.misses,
            hitRate,
            expired: this.expired,
            estimatedMemoryUsage
        };
    }

    /**
     * 모든 키 목록 반환
     */
    keys(): string[] {
        return Array.from(this.cache.keys());
    }

    /**
     * 모든 값 목록 반환
     */
    values(): T[] {
        return Array.from(this.cache.values()).map(item => item.data);
    }

    /**
     * 캐시 크기 반환
     */
    size(): number {
        return this.cache.size;
    }

    /**
     * 항목이 만료되었는지 확인
     */
    private isExpired(item: CacheItem<T>, now?: number): boolean {
        if (!item.ttl) return false;

        const currentTime = now || Date.now();
        return currentTime - item.timestamp > item.ttl;
    }

    /**
     * LRU 알고리즘으로 가장 적게 사용된 항목 제거
     */
    private evictLRU(): void {
        let lruKey: string | undefined;
        let lruTime = Infinity;

        for (const [key, item] of this.cache.entries()) {
            if (item.lastAccessed < lruTime) {
                lruTime = item.lastAccessed;
                lruKey = key;
            }
        }

        if (lruKey) {
            this.cache.delete(lruKey);
        }
    }

    /**
     * 객체 크기 추정 (대략적)
     */
    private estimateObjectSize(obj: any): number {
        let size = 0;

        if (obj === null || obj === undefined) {
            return 8; // 포인터 크기
        }

        switch (typeof obj) {
            case 'string':
                return obj.length * 2; // UTF-16
            case 'number':
                return 8;
            case 'boolean':
                return 4;
            case 'object':
                if (Array.isArray(obj)) {
                    return obj.reduce((acc, item) => acc + this.estimateObjectSize(item), 0);
                } else {
                    for (const key in obj) {
                        size += key.length * 2; // 키 크기
                        size += this.estimateObjectSize(obj[key]); // 값 크기
                    }
                    return size;
                }
            default:
                return 16; // 기타 타입들
        }
    }
}

/**
 * 함수 스키마 전용 캐시 매니저
 */
export class FunctionSchemaCacheManager extends CacheManager<FunctionSchema[]> {
    constructor() {
        super({
            maxSize: 500, // 함수 스키마는 크기가 클 수 있으므로 적은 수
            defaultTTL: 30 * 60 * 1000 // 30분
        });
    }

    /**
     * 도구 정의에서 캐시 키 생성
     */
    generateKey(toolDefinitions: Record<string, any>): string {
        // 도구 정의들의 해시를 생성하여 캐시 키로 사용
        const keys = Object.keys(toolDefinitions).sort();
        const signature = keys.map(key => {
            const tool = toolDefinitions[key];
            return `${key}:${tool.name}:${tool.description}`;
        }).join('|');

        return this.simpleHash(signature);
    }

    /**
     * 간단한 해시 함수
     */
    private simpleHash(str: string): string {
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            const char = str.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash; // 32비트 정수로 변환
        }
        return Math.abs(hash).toString(36);
    }
}

/**
 * 전역 캐시 매니저 인스턴스들
 */
export const globalFunctionSchemaCache = new FunctionSchemaCacheManager();
export const globalToolCache = new CacheManager<any>({
    maxSize: 1000,
    defaultTTL: 60 * 60 * 1000 // 1시간
});

/**
 * 캐시 정리 작업을 주기적으로 실행하는 유틸리티
 */
export class CacheCleanupScheduler {
    private intervals: NodeJS.Timeout[] = [];

    /**
     * 주기적 캐시 정리 시작
     */
    start(cacheManagers: CacheManager[], intervalMs: number = 5 * 60 * 1000): void {
        for (const cache of cacheManagers) {
            const interval = setInterval(() => {
                const cleaned = cache.cleanup();
                if (cleaned > 0) {
                    console.log(`Cache cleanup: removed ${cleaned} expired items`);
                }
            }, intervalMs);

            this.intervals.push(interval);
        }
    }

    /**
     * 주기적 캐시 정리 중지
     */
    stop(): void {
        for (const interval of this.intervals) {
            clearInterval(interval);
        }
        this.intervals = [];
    }
}

/**
 * 전역 캐시 정리 스케줄러
 */
export const globalCacheCleanupScheduler = new CacheCleanupScheduler(); 