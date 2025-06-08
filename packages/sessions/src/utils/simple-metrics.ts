export interface MetricsCollector {
    incrementCounter(name: string, value?: number): void;
    recordGauge(name: string, value: number): void;
    recordHistogram(name: string, value: number): void;
    getMetrics(): Record<string, any>;
    reset(): void;
}

export class SimpleMetricsCollector implements MetricsCollector {
    private counters: Map<string, number> = new Map();
    private gauges: Map<string, number> = new Map();
    private histograms: Map<string, number[]> = new Map();

    incrementCounter(name: string, value: number = 1): void {
        const current = this.counters.get(name) || 0;
        this.counters.set(name, current + value);
    }

    recordGauge(name: string, value: number): void {
        this.gauges.set(name, value);
    }

    recordHistogram(name: string, value: number): void {
        const values = this.histograms.get(name) || [];
        values.push(value);
        this.histograms.set(name, values);
    }

    getMetrics(): Record<string, any> {
        const result: Record<string, any> = {};

        // Add counters
        for (const [name, value] of this.counters) {
            result[`counter_${name}`] = value;
        }

        // Add gauges
        for (const [name, value] of this.gauges) {
            result[`gauge_${name}`] = value;
        }

        // Add histogram summaries
        for (const [name, values] of this.histograms) {
            if (values.length > 0) {
                const sum = values.reduce((a, b) => a + b, 0);
                result[`histogram_${name}_count`] = values.length;
                result[`histogram_${name}_sum`] = sum;
                result[`histogram_${name}_avg`] = sum / values.length;
                result[`histogram_${name}_min`] = Math.min(...values);
                result[`histogram_${name}_max`] = Math.max(...values);
            }
        }

        return result;
    }

    reset(): void {
        this.counters.clear();
        this.gauges.clear();
        this.histograms.clear();
    }
} 