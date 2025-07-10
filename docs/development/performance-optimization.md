# Performance Optimization Guide

This guide covers the performance optimization features and best practices for Robota SDK, particularly focusing on the `@robota-sdk/agents` package.

## Overview

Robota SDK includes comprehensive performance optimization features designed to:

- Minimize memory usage through intelligent caching and lazy loading
- Prevent memory leaks with automatic resource management
- Provide real-time performance monitoring and metrics
- Optimize tool execution speed and efficiency

## Core Performance Features

### 1. Caching System

The caching system prevents redundant computations and transformations, significantly improving performance for repeated operations.

#### Function Schema Caching

```typescript
import { createZodFunctionTool, CacheManager } from '@robota-sdk/agents';

// Default caching (recommended)
const weatherTool = createZodFunctionTool(
  'getWeather',
  'Get weather information',
  weatherSchema,
  async (params) => {
    // Tool implementation with caching
    return getWeatherData(params.city);
  }
);

// Custom cache configuration
const customCache = new CacheManager({
  maxSize: 1000,              // Maximum cached items
  defaultTTL: 30 * 60 * 1000  // 30 minutes expiration
});

const optimizedTool = createZodFunctionTool(
  tools: myTools,
  cacheManager: customCache
});
```

#### Cache Performance Monitoring

```typescript
// Get cache statistics
const stats = provider.getCacheStats();
if (stats) {
  console.log(`Cache hit rate: ${(stats.hitRate * 100).toFixed(2)}%`);
  console.log(`Cache items: ${stats.totalItems}`);
  console.log(`Memory usage: ${(stats.estimatedMemoryUsage / 1024).toFixed(2)}KB`);
}

// Clear cache if needed
provider.clearCache();
```

### 2. Lazy Loading

Lazy loading delays resource initialization until they're actually needed, reducing startup time and memory usage.

#### Tool Lazy Loading

```typescript
import { LazyLoader, globalToolLazyLoader } from '@robota-sdk/agents';

// Register tools with priorities
globalToolLazyLoader.registerTool('criticalTool', criticalToolDef, 1);    // High priority
globalToolLazyLoader.registerTool('optionalTool', optionalToolDef, 10);   // Low priority

// Load on demand
const tool = await globalToolLazyLoader.load('criticalTool');

// Preload high-priority tools
await globalToolLazyLoader.preload(3); // Load top 3 priority tools

// Check loading statistics
const stats = globalToolLazyLoader.getStats();
console.log(`Loaded: ${stats.loadedResources}/${stats.totalResources}`);
console.log(`Average load time: ${stats.averageLoadTime.toFixed(2)}ms`);
```

#### Custom Lazy Loader

```typescript
const customLoader = new LazyLoader({
  maxConcurrentLoads: 2,  // Limit concurrent loading
  cache: customCache      // Use existing cache
});

// Register resources
customLoader.register({
  id: 'heavyResource',
  loader: async () => {
    // Expensive resource initialization
    return await loadHeavyResource();
  },
  priority: 1
});

// Load when needed
const resource = await customLoader.load('heavyResource');
```

### 3. Resource Management

Automatic resource cleanup prevents memory leaks and manages system resources efficiently.

#### Automatic Resource Management

```typescript
import { globalResourceManager } from '@robota-sdk/agents';

// Resources are automatically tracked and cleaned up
// Manual operations if needed:

// Clean old resources (older than configured max age)
const cleaned = await globalResourceManager.cleanupOld();
console.log(`Cleaned ${cleaned} old resources`);

// Clean all resources
await globalResourceManager.cleanupAll();

// Get resource statistics
const stats = globalResourceManager.getStats();
console.log(`Total resources: ${stats.totalResources}`);
console.log(`Memory usage: ${(stats.estimatedMemoryUsage / 1024 / 1024).toFixed(2)}MB`);
console.log(`Average age: ${(stats.averageResourceAge / 1000 / 60).toFixed(1)} minutes`);
```

#### Custom Resource Management

```typescript
import { ResourceManager } from '@robota-sdk/agents';

const customResourceManager = new ResourceManager({
  maxAge: 20 * 60 * 1000,           // 20 minutes max age
  maxMemoryUsage: 50 * 1024 * 1024, // 50MB memory limit
  cleanupIntervalMs: 2 * 60 * 1000, // 2 minutes cleanup interval
  memoryCheckIntervalMs: 30 * 1000  // 30 seconds memory check
});

// Register custom resources
customResourceManager.register({
  id: 'myResource',
  type: 'connection',
  cleanup: async () => {
    // Custom cleanup logic
    await closeConnections();
  },
  memoryUsage: 1024 * 1024, // 1MB
  description: 'Database connection pool'
});
```

### 4. Performance Monitoring

Real-time performance tracking helps identify bottlenecks and optimize performance.

#### Basic Monitoring

```typescript
import { globalPerformanceMonitor } from '@robota-sdk/agents';

// Performance monitoring is automatic for all tool calls
// Access current metrics
const metrics = globalPerformanceMonitor.getMetrics();

console.log(`Total calls: ${metrics.toolCallCount}`);
console.log(`Success rate: ${(metrics.successRate * 100).toFixed(2)}%`);
console.log(`Average response time: ${metrics.averageCallTime.toFixed(2)}ms`);
console.log(`Throughput: ${metrics.throughput.toFixed(2)} calls/second`);

// Memory metrics
console.log(`Current heap: ${(metrics.memoryUsage.currentHeapUsed / 1024 / 1024).toFixed(2)}MB`);
console.log(`Max heap: ${(metrics.memoryUsage.maxHeapUsed / 1024 / 1024).toFixed(2)}MB`);
```

#### Tool-Specific Monitoring

```typescript
// Get metrics for specific tools
const weatherToolMetrics = globalPerformanceMonitor.getToolMetrics('getWeather');
console.log(`Weather tool average time: ${weatherToolMetrics.averageCallTime?.toFixed(2)}ms`);

// Generate comprehensive report
const report = globalPerformanceMonitor.generateReport();
console.log(report);
```

#### Event-Based Monitoring

```typescript
// Listen for performance events
globalPerformanceMonitor.addEventListener((metrics) => {
  // Alert on performance degradation
  if (metrics.averageCallTime > 1000) {
    console.warn('Performance Alert: Average call time exceeds 1 second');
  }
  
  // Alert on low success rate
  if (metrics.successRate < 0.95) {
    console.warn('Reliability Alert: Success rate below 95%');
  }
  
  // Alert on high memory usage
  const memoryMB = metrics.memoryUsage.currentHeapUsed / 1024 / 1024;
  if (memoryMB > 100) {
    console.warn(`Memory Alert: Heap usage is ${memoryMB.toFixed(2)}MB`);
  }
});

// Start monitoring
globalPerformanceMonitor.startMonitoring(5000); // Every 5 seconds
```

## Best Practices

### 1. Tool Provider Configuration

```typescript
// Optimal configuration for production
const performanceTool = createZodFunctionTool(
  'performanceTask',
  'Execute performance-optimized task',
  performanceSchema,
  async (params) => {
    // Tool implementation with performance optimization
    return await executeOptimizedTask(params);
  }
);
```

### 2. Memory Management

```typescript
// In long-running applications
setInterval(async () => {
  // Periodic cleanup
  await globalResourceManager.cleanupOld();
  
  // Monitor memory usage
  const stats = globalResourceManager.getStats();
  const memoryMB = stats.estimatedMemoryUsage / 1024 / 1024;
  
  if (memoryMB > 200) { // 200MB threshold
    console.warn(`High memory usage: ${memoryMB.toFixed(2)}MB`);
    await globalResourceManager.cleanupHighMemoryUsage();
  }
}, 5 * 60 * 1000); // Every 5 minutes
```

### 3. Performance Monitoring Setup

```typescript
// Production monitoring setup
class ProductionMonitor {
  constructor() {
    this.setupPerformanceMonitoring();
    this.setupResourceMonitoring();
  }
  
  private setupPerformanceMonitoring() {
    globalPerformanceMonitor.addEventListener((metrics) => {
      // Send metrics to monitoring service
      this.sendMetricsToService({
        timestamp: Date.now(),
        averageCallTime: metrics.averageCallTime,
        successRate: metrics.successRate,
        throughput: metrics.throughput,
        memoryUsage: metrics.memoryUsage.currentHeapUsed
      });
      
      // Performance alerts
      if (metrics.averageCallTime > 2000) {
        this.sendAlert('HIGH_LATENCY', metrics.averageCallTime);
      }
    });
    
    globalPerformanceMonitor.startMonitoring(10000); // Every 10 seconds
  }
  
  private setupResourceMonitoring() {
    setInterval(async () => {
      const stats = globalResourceManager.getStats();
      
      // Resource alerts
      if (stats.totalResources > 1000) {
        this.sendAlert('HIGH_RESOURCE_COUNT', stats.totalResources);
      }
      
      const memoryMB = stats.estimatedMemoryUsage / 1024 / 1024;
      if (memoryMB > 500) {
        this.sendAlert('HIGH_MEMORY_USAGE', memoryMB);
        await globalResourceManager.cleanupOld();
      }
    }, 30000); // Every 30 seconds
  }
  
  private sendAlert(type: string, value: number) {
    console.error(`ALERT [${type}]: ${value}`);
    // Send to alerting service
  }
  
  private sendMetricsToService(metrics: any) {
    // Send to metrics collection service
  }
}

// Initialize in production
if (process.env.NODE_ENV === 'production') {
  new ProductionMonitor();
}
```

### 4. Graceful Shutdown

```typescript
// Ensure clean shutdown
process.on('SIGINT', async () => {
  console.log('Shutting down gracefully...');
  
  // Stop monitoring
  globalPerformanceMonitor.stopMonitoring();
  
  // Clean up resources
  await globalResourceManager.shutdown();
  
  process.exit(0);
});

process.on('SIGTERM', async () => {
  await globalResourceManager.shutdown();
  process.exit(0);
});
```

## Performance Metrics Reference

### Cache Metrics
- `hitRate`: Cache hit ratio (0-1)
- `totalItems`: Number of cached items
- `hits`: Number of cache hits
- `misses`: Number of cache misses
- `estimatedMemoryUsage`: Estimated cache memory usage in bytes

### Performance Metrics
- `toolCallCount`: Total number of tool calls
- `averageCallTime`: Average call duration in milliseconds
- `maxCallTime`: Maximum call duration in milliseconds
- `minCallTime`: Minimum call duration in milliseconds
- `successRate`: Success rate (0-1)
- `throughput`: Calls per second (TPS)

### Memory Metrics
- `currentHeapUsed`: Current heap usage in bytes
- `maxHeapUsed`: Peak heap usage in bytes
- `averageHeapUsed`: Average heap usage in bytes
- `external`: External memory usage in bytes
- `rss`: Resident Set Size in bytes

### Resource Metrics
- `totalResources`: Number of managed resources
- `byType`: Resource count by type
- `oldestResourceAge`: Age of oldest resource in milliseconds
- `averageResourceAge`: Average resource age in milliseconds
- `estimatedMemoryUsage`: Total estimated memory usage in bytes

## Troubleshooting Performance Issues

### High Memory Usage
1. Check resource statistics: `globalResourceManager.getStats()`
2. Force cleanup: `await globalResourceManager.cleanupOld()`
3. Monitor cache usage: `provider.getCacheStats()`
4. Clear caches if needed: `provider.clearCache()`

### Slow Tool Execution
1. Check performance metrics: `globalPerformanceMonitor.getMetrics()`
2. Identify slow tools: `globalPerformanceMonitor.getToolMetrics(toolName)`
3. Enable caching for repeated operations
4. Use lazy loading for heavy resources

### Memory Leaks
1. Enable resource monitoring
2. Set up automatic cleanup intervals
3. Monitor resource growth over time
4. Implement proper error handling in tool cleanup functions 