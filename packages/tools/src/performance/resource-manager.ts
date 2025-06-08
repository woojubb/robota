/**
 * Resource Manager for Memory Leak Prevention
 * 
 * @module resource-manager
 * @description
 * Provides a system to prevent memory leaks and monitor resource usage.
 */

import { CacheManager, CacheCleanupScheduler } from './cache-manager';
import { LazyLoader } from './lazy-loader';

/**
 * Resource type definition
 */
export type ResourceType = 'cache' | 'loader' | 'provider' | 'connection' | 'timer' | 'other';

/**
 * Resource information interface
 */
export interface ResourceInfo {
    /** Resource identifier */
    id: string;
    /** Resource type */
    type: ResourceType;
    /** Creation time */
    createdAt: number;
    /** Last used time */
    lastUsed: number;
    /** Cleanup function */
    cleanup: () => Promise<void> | void;
    /** Estimated memory usage */
    memoryUsage?: number;
    /** Description */
    description?: string;
}

/**
 * Memory usage information
 */
export interface MemoryInfo {
    /** Heap usage (bytes) */
    heapUsed: number;
    /** Heap size (bytes) */
    heapTotal: number;
    /** External memory (bytes) */
    external: number;
    /** RSS (Resident Set Size) */
    rss: number;
}

/**
 * Resource statistics
 */
export interface ResourceStats {
    /** Total resources count */
    totalResources: number;
    /** Resource count by type */
    byType: Record<ResourceType, number>;
    /** Oldest resource age (milliseconds) */
    oldestResourceAge: number;
    /** Average resource age (milliseconds) */
    averageResourceAge: number;
    /** Total estimated memory usage */
    estimatedMemoryUsage: number;
    /** System memory information */
    systemMemory: MemoryInfo;
}

/**
 * Resource manager class
 */
export class ResourceManager {
    private resources: Map<string, ResourceInfo> = new Map();
    private cleanupInterval?: NodeJS.Timeout;
    private memoryCheckInterval?: NodeJS.Timeout;
    private maxAge: number; // milliseconds
    private maxMemoryUsage: number; // bytes
    private isShuttingDown = false;

    constructor(options: {
        maxAge?: number; // default: 1 hour
        maxMemoryUsage?: number; // default: 100MB
        cleanupIntervalMs?: number; // default: 5 minutes
        memoryCheckIntervalMs?: number; // default: 30 seconds
    } = {}) {
        this.maxAge = options.maxAge || 60 * 60 * 1000; // 1 hour
        this.maxMemoryUsage = options.maxMemoryUsage || 100 * 1024 * 1024; // 100MB

        // Start periodic cleanup task
        const cleanupIntervalMs = options.cleanupIntervalMs || 5 * 60 * 1000; // 5 minutes
        this.cleanupInterval = setInterval(() => {
            this.performCleanup().catch(console.error);
        }, cleanupIntervalMs);

        // Start memory check task
        const memoryCheckIntervalMs = options.memoryCheckIntervalMs || 30 * 1000; // 30 seconds
        this.memoryCheckInterval = setInterval(() => {
            this.checkMemoryUsage().catch(console.error);
        }, memoryCheckIntervalMs);

        // Cleanup on process exit
        process.on('beforeExit', () => this.shutdown());
        process.on('SIGINT', () => this.shutdown());
        process.on('SIGTERM', () => this.shutdown());
    }

    /**
     * Register resource
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
     * Update resource usage record
     */
    markUsed(id: string): void {
        const resource = this.resources.get(id);
        if (resource) {
            resource.lastUsed = Date.now();
        }
    }

    /**
     * Cleanup resource
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
            console.error(`Error cleaning up resource '${id}':`, error);
            return false;
        }
    }

    /**
     * Cleanup all resources
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
     * Cleanup old resources
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
     * Cleanup high memory usage resources
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
     * Check if resource exists
     */
    has(id: string): boolean {
        return this.resources.has(id);
    }

    /**
     * Get all registered resource IDs
     */
    getResourceIds(): string[] {
        return Array.from(this.resources.keys());
    }

    /**
     * Get resource IDs by type
     */
    getResourceIdsByType(type: ResourceType): string[] {
        return Array.from(this.resources.values())
            .filter(resource => resource.type === type)
            .map(resource => resource.id);
    }

    /**
     * Get resource statistics
     */
    getStats(): ResourceStats {
        const now = Date.now();
        const resources = Array.from(this.resources.values());

        // Aggregate by type
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
     * Cleanup on system shutdown
     */
    async shutdown(): Promise<void> {
        if (this.isShuttingDown) {
            return;
        }

        this.isShuttingDown = true;

        // Clear timers
        if (this.cleanupInterval) {
            clearInterval(this.cleanupInterval);
        }
        if (this.memoryCheckInterval) {
            clearInterval(this.memoryCheckInterval);
        }

        // Cleanup all resources
        await this.cleanupAll();
    }

    /**
     * Calculate total memory usage
     */
    private getTotalMemoryUsage(): number {
        return Array.from(this.resources.values())
            .reduce((total, resource) => total + (resource.memoryUsage || 0), 0);
    }

    /**
     * Perform periodic cleanup
     */
    private async performCleanup(): Promise<void> {
        try {
            const oldCleaned = await this.cleanupOld();
            if (oldCleaned > 0) {
                // eslint-disable-next-line no-console
                console.log(`Resource cleanup: cleaned up ${oldCleaned} old resources.`);
            }
        } catch (error) {
            console.error('Error during periodic resource cleanup:', error);
        }
    }

    /**
     * Check memory usage
     */
    private async checkMemoryUsage(): Promise<void> {
        try {
            const totalMemory = this.getTotalMemoryUsage();
            if (totalMemory > this.maxMemoryUsage) {
                const cleaned = await this.cleanupHighMemoryUsage();
                console.warn(`Memory usage exceeded limit, cleaned up ${cleaned} resources.`);
            }
        } catch (error) {
            console.error('Error during memory usage check:', error);
        }
    }

    /**
     * Get system memory information
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
 * Resource manager for Tool Providers
 */
export class ToolProviderResourceManager extends ResourceManager {
    constructor() {
        super({
            maxAge: 30 * 60 * 1000, // 30 minutes
            maxMemoryUsage: 50 * 1024 * 1024, // 50MB
            cleanupIntervalMs: 3 * 60 * 1000, // 3 minutes
            memoryCheckIntervalMs: 20 * 1000 // 20 seconds
        });
    }

    /**
     * Register cache manager
     */
    registerCache(id: string, cache: CacheManager, description?: string): void {
        this.register({
            id,
            type: 'cache',
            cleanup: () => cache.clear(),
            memoryUsage: cache.getStats().estimatedMemoryUsage,
            description: description || `Cache manager: ${id}`
        });
    }

    /**
     * Register lazy loader
     */
    registerLazyLoader(id: string, loader: LazyLoader, description?: string): void {
        this.register({
            id,
            type: 'loader',
            cleanup: () => loader.unloadAll(),
            memoryUsage: loader.getStats().estimatedMemoryUsage,
            description: description || `Lazy loader: ${id}`
        });
    }

    /**
     * Register cleanup scheduler
     */
    registerCleanupScheduler(id: string, scheduler: CacheCleanupScheduler, description?: string): void {
        this.register({
            id,
            type: 'timer',
            cleanup: () => scheduler.stop(),
            description: description || `Cleanup scheduler: ${id}`
        });
    }
}

/**
 * Global resource manager instance
 */
export const globalResourceManager = new ToolProviderResourceManager(); 