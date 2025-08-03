/**
 * Cached Executor for Examples
 * 
 * Purpose: Wrap example execution with intelligent caching
 * Rules: NEVER skip cache check, ALWAYS save successful results
 */

import { CacheManager } from './cache-manager';

export class CachedExecutor {
    private cacheManager: CacheManager;
    private sessionStats = { cacheHits: 0, totalRuns: 0 };

    constructor() {
        this.cacheManager = new CacheManager();
    }

    /**
     * Execute example with cache-first strategy
     */
    async executeWithCache<T>(
        exampleName: string,
        sourceFile: string,
        executorFn: () => Promise<T>,
        logCapture: string[] = []
    ): Promise<T> {
        this.sessionStats.totalRuns++;

        // 🚨 MANDATORY: Check cache before LLM execution
        const cacheKey = this.cacheManager.generateCacheKey(exampleName, sourceFile);
        const cacheResult = this.cacheManager.checkCache(cacheKey);

        if (cacheResult.isValid && cacheResult.data) {
            this.sessionStats.cacheHits++;
            console.log('🚀 Using cached result (no LLM calls)');
            this.logSessionStats();
            return cacheResult.data.executionResult as T;
        }

        // Cache miss - execute with LLM
        console.log('💰 Making LLM call (not cached)');
        const startTime = Date.now();

        try {
            const result = await executorFn();
            const executionTime = Date.now() - startTime;

            // 🚨 MANDATORY: Save successful results to cache
            this.cacheManager.saveToCache(cacheKey, result, logCapture);
            console.log(`⏱️ Execution completed in ${executionTime}ms`);
            this.logSessionStats();

            return result;

        } catch (error) {
            console.error(`❌ Execution failed: ${error}`);
            throw error;
        }
    }

    /**
     * Filter cached logs for analysis
     */
    filterCachedLogs(cacheKey: string, patterns: string[]): string[] {
        const cacheResult = this.cacheManager.checkCache(cacheKey);
        if (!cacheResult.isValid || !cacheResult.data) {
            return [];
        }

        return cacheResult.data.executionResult.logs.filter(log =>
            patterns.some(pattern => log.includes(pattern))
        );
    }

    /**
     * Analyze cached workflow structure
     */
    analyzeCachedWorkflow(cacheKey: string): {
        nodeCount: number;
        edgeCount: number;
        agentCopyNodes: any[];
        connectionStats: any;
    } {
        const cacheResult = this.cacheManager.checkCache(cacheKey);
        if (!cacheResult.isValid || !cacheResult.data) {
            return { nodeCount: 0, edgeCount: 0, agentCopyNodes: [], connectionStats: {} };
        }

        const { nodes, edges } = cacheResult.data.executionResult;
        const agentCopyNodes = nodes.filter((node: any) =>
            node.id && node.id.includes('agent_') && node.id.includes('_copy_')
        );

        return {
            nodeCount: nodes.length,
            edgeCount: edges.length,
            agentCopyNodes,
            connectionStats: {
                processesConnections: edges.filter((e: any) => e.type === 'processes').length,
                returnConnections: edges.filter((e: any) => e.type === 'return').length
            }
        };
    }

    /**
     * Log session statistics
     */
    private logSessionStats(): void {
        const hitRate = ((this.sessionStats.cacheHits / this.sessionStats.totalRuns) * 100).toFixed(1);
        console.log(`📊 Session stats: ${this.sessionStats.cacheHits}/${this.sessionStats.totalRuns} cached (${hitRate}%)`);
    }

    /**
     * Clear cache and reset stats
     */
    clearCache(): void {
        this.cacheManager.clearCache();
        this.sessionStats = { cacheHits: 0, totalRuns: 0 };
    }

    /**
     * Get cache statistics
     */
    getCacheStats() {
        return {
            ...this.cacheManager.getCacheStats(),
            sessionStats: this.sessionStats
        };
    }
}