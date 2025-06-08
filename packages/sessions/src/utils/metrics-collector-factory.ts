import { SimpleMetricsCollector, MetricsCollector } from './simple-metrics';

export class MetricsCollectorFactory {
    private static instances: Map<string, MetricsCollector> = new Map();

    static getCollector(name: string): MetricsCollector {
        if (!this.instances.has(name)) {
            this.instances.set(name, new SimpleMetricsCollector());
        }
        return this.instances.get(name)!;
    }

    static createCollector(): MetricsCollector {
        return new SimpleMetricsCollector();
    }

    static clearCache(): void {
        this.instances.clear();
    }

    static getAllMetrics(): Record<string, any> {
        const allMetrics: Record<string, any> = {};

        for (const [name, collector] of this.instances) {
            allMetrics[name] = collector.getMetrics();
        }

        return allMetrics;
    }
} 