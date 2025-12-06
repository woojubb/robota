/**
 * Cache Manager for Example Execution Results
 * 
 * Purpose: Prevent unnecessary LLM API calls by caching execution results
 * Cost Impact: 80-90% reduction in LLM API calls during development
 */

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { fileURLToPath } from 'url';

// ES module __dirname equivalent
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface CacheEntry {
    timestamp: number;
    sourceFileHash: string;
    dependencyVersions: Record<string, string>;
    executionResult: {
        nodes: any[];
        edges: any[];
        logs: string[];
        metadata: any;
    };
    success: boolean;
    errorMessage?: string;
}

export class CacheManager {
    private cacheDir: string;

    constructor() {
        this.cacheDir = path.join(__dirname, '../cache');
        this.ensureCacheDir();
    }

    private ensureCacheDir(): void {
        if (!fs.existsSync(this.cacheDir)) {
            fs.mkdirSync(this.cacheDir, { recursive: true });
        }
    }

    /**
     * Generate cache key based on source file and dependencies
     */
    generateCacheKey(exampleName: string, sourceFile: string): string {
        const sourceContent = fs.readFileSync(sourceFile, 'utf-8');
        const sourceHash = crypto.createHash('md5').update(sourceContent).digest('hex');

        // Simple dependency version (can be enhanced)
        const depVersions = this.getDependencyVersions();
        const depHash = crypto.createHash('md5').update(JSON.stringify(depVersions)).digest('hex');

        return `${exampleName}-${sourceHash.substring(0, 8)}-${depHash.substring(0, 8)}`;
    }

    /**
     * Check if cached result exists and is valid
     */
    checkCache(cacheKey: string): { isValid: boolean; data?: CacheEntry } {
        const cacheFile = path.join(this.cacheDir, `${cacheKey}.json`);

        if (!fs.existsSync(cacheFile)) {
            console.log(`💰 Cache MISS: ${cacheKey} (file not found)`);
            return { isValid: false };
        }

        try {
            const cachedData: CacheEntry = JSON.parse(fs.readFileSync(cacheFile, 'utf-8'));

            // Check if cache is expired (24 hours)
            const isExpired = Date.now() - cachedData.timestamp > 24 * 60 * 60 * 1000;
            if (isExpired) {
                console.log(`💰 Cache MISS: ${cacheKey} (expired)`);
                return { isValid: false };
            }

            console.log(`🚀 Cache HIT: ${cacheKey} (saved ~$0.10)`);
            return { isValid: true, data: cachedData };

        } catch (error) {
            console.log(`💰 Cache MISS: ${cacheKey} (corrupted)`);
            return { isValid: false };
        }
    }

    /**
     * Save execution result to cache
     */
    saveToCache(cacheKey: string, result: any, logs: string[]): void {
        const cacheEntry: CacheEntry = {
            timestamp: Date.now(),
            sourceFileHash: '', // Will be filled by generateCacheKey
            dependencyVersions: this.getDependencyVersions(),
            executionResult: {
                nodes: result.nodes || [],
                edges: result.edges || [],
                logs: logs,
                metadata: result.metadata || {}
            },
            success: true
        };

        const cacheFile = path.join(this.cacheDir, `${cacheKey}.json`);
        fs.writeFileSync(cacheFile, JSON.stringify(cacheEntry, null, 2));
        console.log(`💾 Cache SAVED: ${cacheKey}`);
    }

    /**
     * Clear all cache files
     */
    clearCache(): void {
        if (fs.existsSync(this.cacheDir)) {
            const files = fs.readdirSync(this.cacheDir);
            files.forEach(file => {
                if (file.endsWith('.json')) {
                    fs.unlinkSync(path.join(this.cacheDir, file));
                }
            });
        }
        console.log('🗑️ Cache cleared');
    }

    /**
     * Get cache statistics
     */
    getCacheStats(): { totalFiles: number; totalSize: number; oldestCache: number } {
        if (!fs.existsSync(this.cacheDir)) {
            return { totalFiles: 0, totalSize: 0, oldestCache: 0 };
        }

        const files = fs.readdirSync(this.cacheDir).filter(f => f.endsWith('.json'));
        let totalSize = 0;
        let oldestCache = Date.now();

        files.forEach(file => {
            const filePath = path.join(this.cacheDir, file);
            const stats = fs.statSync(filePath);
            totalSize += stats.size;
            oldestCache = Math.min(oldestCache, stats.mtime.getTime());
        });

        return { totalFiles: files.length, totalSize, oldestCache };
    }

    private getDependencyVersions(): Record<string, string> {
        // Simplified version tracking
        try {
            const packageJsonPath = path.join(__dirname, '../../package.json');
            if (fs.existsSync(packageJsonPath)) {
                const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
                return {
                    agents: packageJson.dependencies?.['@robota-sdk/agents'] || 'unknown',
                    team_assignTask: packageJson.dependencies?.['@robota-sdk/team'] || 'unknown' // assignTask MCP tool collection only
                };
            }
        } catch (error) {
            // Fallback
        }
        return { timestamp: Date.now().toString() };
    }
}