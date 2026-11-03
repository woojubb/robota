/**
 * The Node-only surface of `agent-plugin`.
 *
 * The main entry is platform-neutral (ARCHITECTURE.md "Runtime platforms"): it never reaches a Node
 * built-in or global. What needs a Node host lives here, and a composition root injects it into the
 * plugins through their `fileStore` and `metricsCollector` options.
 */
export { NodePluginTextFileStore } from './storage/node-text-file-store.js';
export { NodeSystemMetricsCollector } from './performance/collectors/system-metrics-collector.js';
