import { SystemMetricsCollector, PerformanceMetrics } from '../types';
import { Logger } from '../../../utils/logger';

/**
 * Node.js system metrics collector
 */
export class NodeSystemMetricsCollector implements SystemMetricsCollector {
    private logger: Logger;

    constructor() {
        this.logger = new Logger('NodeSystemMetricsCollector');
    }

    async getMemoryUsage(): Promise<PerformanceMetrics['memoryUsage']> {
        try {
            const memoryUsage = process.memoryUsage();

            // Note: This is a basic implementation for Node.js
            // In production, you might want to use more sophisticated system monitoring libraries
            return {
                used: memoryUsage.rss,
                free: 0, // Not directly available in Node.js without additional libraries
                total: memoryUsage.rss + memoryUsage.external,
                heap: {
                    used: memoryUsage.heapUsed,
                    total: memoryUsage.heapTotal
                }
            };
        } catch (error) {
            this.logger.warn('Failed to get memory usage', {
                error: error instanceof Error ? error.message : String(error)
            });
            return undefined;
        }
    }

    async getCPUUsage(): Promise<PerformanceMetrics['cpuUsage']> {
        try {
            const cpuUsage = process.cpuUsage();

            // Note: This is a basic implementation for Node.js
            // For more accurate CPU percentage, you'd need to measure over time intervals
            return {
                user: cpuUsage.user,
                system: cpuUsage.system,
                percent: 0 // Would need time-based calculation for actual percentage
            };
        } catch (error) {
            this.logger.warn('Failed to get CPU usage', {
                error: error instanceof Error ? error.message : String(error)
            });
            return undefined;
        }
    }

    async getNetworkStats(): Promise<PerformanceMetrics['networkStats']> {
        try {
            // Note: Network stats are not directly available in Node.js without additional monitoring
            // This would typically require integrating with system monitoring tools or libraries
            this.logger.warn('Network stats monitoring not fully implemented yet');
            return undefined;
        } catch (error) {
            this.logger.warn('Failed to get network stats', {
                error: error instanceof Error ? error.message : String(error)
            });
            return undefined;
        }
    }
} 