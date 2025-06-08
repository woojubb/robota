/**
 * Lazy Loading System for Tool Performance Optimization
 * 
 * @module lazy-loader
 * @description
 * Loads tools and related resources only when needed to optimize memory usage and initial loading time.
 */

import { CacheManager } from './cache-manager';

/**
 * Interface for lazy loadable resources
 */
export interface LazyLoadable<T> {
    /** Resource identifier */
    id: string;
    /** Function to load the resource */
    loader: () => Promise<T> | T;
    /** Whether the resource is loaded */
    isLoaded: boolean;
    /** Loaded resource */
    resource?: T;
    /** Last access time */
    lastAccessed?: number;
    /** Loading priority (lower number = higher priority) */
    priority?: number;
}

/**
 * Lazy loading statistics
 */
export interface LazyLoadStats {
    /** Total registered resources count */
    totalResources: number;
    /** Loaded resources count */
    loadedResources: number;
    /** Load successes count */
    loadSuccesses: number;
    /** Load failures count */
    loadFailures: number;
    /** Average loading time (milliseconds) */
    averageLoadTime: number;
    /** Total estimated memory usage */
    estimatedMemoryUsage: number;
}

/**
 * Lazy loading manager class
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
     * Register a lazy loadable resource
     */
    register(resource: Omit<LazyLoadable<T>, 'isLoaded'>): void {
        this.resources.set(resource.id, {
            ...resource,
            isLoaded: false,
            lastAccessed: undefined
        });
    }

    /**
     * Register multiple resources at once
     */
    registerMany(resources: Array<Omit<LazyLoadable<T>, 'isLoaded'>>): void {
        for (const resource of resources) {
            this.register(resource);
        }
    }

    /**
     * Load resource (async)
     */
    async load(id: string): Promise<T> {
        const resource = this.resources.get(id);
        if (!resource) {
            throw new Error(`Resource '${id}' not found.`);
        }

        // If already loaded
        if (resource.isLoaded && resource.resource) {
            resource.lastAccessed = Date.now();
            return resource.resource;
        }

        // Check cache
        if (this.cache) {
            const cached = this.cache.get(id);
            if (cached) {
                resource.resource = cached;
                resource.isLoaded = true;
                resource.lastAccessed = Date.now();
                return cached;
            }
        }

        // Check if currently loading
        const existingPromise = this.loadPromises.get(id);
        if (existingPromise) {
            return existingPromise;
        }

        // Check concurrent loading limit
        if (this.currentLoads >= this.maxConcurrentLoads) {
            return new Promise<T>((resolve, reject) => {
                this.loadQueue.push({ id, resolve, reject });
            });
        }

        // Perform actual loading
        return this.performLoad(id, resource);
    }

    /**
     * Load multiple resources in parallel
     */
    async loadMany(ids: string[]): Promise<T[]> {
        const promises = ids.map(id => this.load(id));
        return Promise.all(promises);
    }

    /**
     * Preload resources by priority
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
     * Unload resource (memory cleanup)
     */
    unload(id: string): boolean {
        const resource = this.resources.get(id);
        if (!resource || !resource.isLoaded) {
            return false;
        }

        resource.resource = undefined;
        resource.isLoaded = false;
        resource.lastAccessed = undefined;

        // Remove from cache as well
        if (this.cache) {
            this.cache.delete(id);
        }

        return true;
    }

    /**
     * Unload oldest resources (LRU based)
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
     * Unload all resources
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
     * Check if resource is loaded
     */
    isLoaded(id: string): boolean {
        const resource = this.resources.get(id);
        return resource?.isLoaded || false;
    }

    /**
     * Get all registered resource IDs
     */
    getResourceIds(): string[] {
        return Array.from(this.resources.keys());
    }

    /**
     * Get loaded resource IDs
     */
    getLoadedResourceIds(): string[] {
        return Array.from(this.resources.values())
            .filter(resource => resource.isLoaded)
            .map(resource => resource.id);
    }

    /**
     * Get lazy loading statistics
     */
    getStats(): LazyLoadStats {
        const totalResources = this.resources.size;
        const loadedResources = Array.from(this.resources.values())
            .filter(resource => resource.isLoaded).length;

        const averageLoadTime = this.loadTimes.length > 0
            ? this.loadTimes.reduce((sum, time) => sum + time, 0) / this.loadTimes.length
            : 0;

        // Estimate memory usage
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
     * Perform actual loading
     */
    private async performLoad(id: string, resource: LazyLoadable<T>): Promise<T> {
        const startTime = performance.now();
        this.currentLoads++;

        const promise = (async () => {
            try {
                const loaded = await Promise.resolve(resource.loader());

                // Update resource
                resource.resource = loaded;
                resource.isLoaded = true;
                resource.lastAccessed = Date.now();

                // Save to cache
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
     * Process pending loading requests
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
                reject(new Error(`Resource '${id}' not found.`));
            }
        }
    }

    /**
     * Estimate resource size
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
 * Tool-specific lazy loader
 */
export class ToolLazyLoader extends LazyLoader<any> {
    constructor() {
        super({
            cache: new CacheManager({
                maxSize: 100,
                defaultTTL: 60 * 60 * 1000 // 1 hour
            }),
            maxConcurrentLoads: 3
        });
    }

    /**
     * Create lazy loading resource from tool definition
     */
    registerTool(toolId: string, toolDefinition: any, priority: number = 999): void {
        this.register({
            id: toolId,
            loader: () => {
                // Logic to convert tool definition to actual tool instance
                return Promise.resolve(toolDefinition);
            },
            priority
        });
    }
}

/**
 * Global tool lazy loader instance
 */
export const globalToolLazyLoader = new ToolLazyLoader(); 