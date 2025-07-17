# Plugin Configuration Examples

This document provides practical examples of how to configure each plugin in the `@robota-sdk/agents` package, including how to disable them when needed.

## 🌐 Browser-Specific Configuration

### Recommended Browser Setup
```typescript
import { 
  Robota, 
  LoggingPlugin, 
  UsagePlugin, 
  ConversationHistoryPlugin,
  EventEmitterPlugin 
} from '@robota-sdk/agents';

// Browser-optimized configuration
const agent = new Robota({
  name: 'BrowserAgent',
  plugins: [
    // Use console logging (no file system)
    new LoggingPlugin({ 
      strategy: 'console',
      level: 'info'
    }),
    
    // Use memory storage (no file system)
    new UsagePlugin({ 
      strategy: 'memory',
      aggregationInterval: 60000 // 1 minute
    }),
    
    // Memory-based conversation history
    new ConversationHistoryPlugin({
      storage: { 
        strategy: 'memory',
        maxSize: 1000 // Limit memory usage
      },
      autoSave: true,
      batchSize: 10
    }),
    
    // Event system works universally
    new EventEmitterPlugin({
      enabled: true,
      events: ['execution.start', 'execution.complete', 'tool.execute']
    })
  ]
});
```

### What to Avoid in Browsers
```typescript
// ❌ Don't use file storage in browsers
new LoggingPlugin({ strategy: 'file' });        // Will fail
new UsagePlugin({ strategy: 'file' });          // Will fail
new ConversationHistoryPlugin({ 
  storage: { strategy: 'file' }                 // Will fail
});

// ✅ Use browser-compatible alternatives
new LoggingPlugin({ strategy: 'console' });     // Works everywhere
new UsagePlugin({ strategy: 'memory' });        // Works everywhere
new ConversationHistoryPlugin({ 
  storage: { strategy: 'memory' }               // Works everywhere
});
```

## Quick Reference

### Complete Plugin Disable Examples

```typescript
// Disable all plugins
const agent = new Robota({
  plugins: [
    // No plugins - completely disabled
  ]
});

// Disable specific plugins by omitting them
const agent = new Robota({
  plugins: [
    new LoggingPlugin({ strategy: 'console' }),
    // EventEmitterPlugin omitted - disabled
    // UsagePlugin omitted - disabled
  ]
});

// Disable plugins using enabled: false
const agent = new Robota({
  plugins: [
    new LoggingPlugin({ strategy: 'console', enabled: false }),
    new EventEmitterPlugin({ enabled: false }),
    new UsagePlugin({ strategy: 'silent', enabled: false })
  ]
});
```

---

## EventEmitterPlugin

### Basic Configuration
```typescript
import { EventEmitterPlugin } from '@robota-sdk/agents';

const eventPlugin = new EventEmitterPlugin({
  enabled: true,
  events: [
    'execution.start',
    'execution.complete',
    'execution.error',
    'tool.beforeExecute',
    'tool.afterExecute'
  ],
  maxListeners: 100,
  async: true,
  catchErrors: true
});
```

### Disable Options
```typescript
// Complete disable
const disabledPlugin = new EventEmitterPlugin({
  enabled: false
});

// Selective disable - no events
const noEventsPlugin = new EventEmitterPlugin({
  events: []
});

// Synchronous mode (less overhead)
const syncPlugin = new EventEmitterPlugin({
  async: false,
  catchErrors: false
});
```

### Advanced Configuration
```typescript
// With buffering for high-throughput scenarios
const bufferedPlugin = new EventEmitterPlugin({
  buffer: {
    enabled: true,
    maxSize: 1000,
    flushInterval: 5000
  },
  events: ['execution.complete', 'tool.success'],
  filters: {
    'execution.complete': (event) => event.duration > 1000 // Only slow executions
  }
});
```

---

## LoggingPlugin

### Strategy Examples
```typescript
import { LoggingPlugin } from '@robota-sdk/agents';

// Console logging (development)
const consoleLogger = new LoggingPlugin({
  strategy: 'console',
  level: 'info',
  includeStackTrace: true
});

// File logging (production)
const fileLogger = new LoggingPlugin({
  strategy: 'file',
  level: 'warn',
  filePath: './logs/agent.log',
  maxLogs: 50000,
  batchSize: 100,
  flushInterval: 30000
});

// Remote logging (monitoring)
const remoteLogger = new LoggingPlugin({
  strategy: 'remote',
  level: 'error',
  remoteEndpoint: 'https://logs.example.com/api/logs',
  remoteHeaders: {
    'Authorization': 'Bearer your-token',
    'Content-Type': 'application/json'
  },
  batchSize: 50,
  flushInterval: 10000
});
```

### Disable Options
```typescript
// Complete disable
const disabledLogger = new LoggingPlugin({
  strategy: 'silent',
  enabled: false
});

// Minimal logging (errors only)
const minimalLogger = new LoggingPlugin({
  strategy: 'console',
  level: 'error',
  includeStackTrace: false
});
```

---

## UsagePlugin

### Strategy Examples
```typescript
import { UsagePlugin } from '@robota-sdk/agents';

// Memory tracking (development)
const memoryUsage = new UsagePlugin({
  strategy: 'memory',
  maxEntries: 1000,
  trackCosts: true,
  aggregateStats: true
});

// File tracking (production)
const fileUsage = new UsagePlugin({
  strategy: 'file',
  filePath: './usage-stats.json',
  maxEntries: 10000,
  trackCosts: true,
  costRates: {
    'gpt-4': { input: 0.03, output: 0.06 },
    'gpt-3.5-turbo': { input: 0.001, output: 0.002 }
  },
  batchSize: 50,
  flushInterval: 60000
});

// Remote tracking (analytics)
const remoteUsage = new UsagePlugin({
  strategy: 'remote',
  remoteEndpoint: 'https://analytics.example.com/api/usage',
  remoteHeaders: {
    'API-Key': 'your-api-key'
  },
  batchSize: 100,
  flushInterval: 300000 // 5 minutes
});
```

### Disable Options
```typescript
// Complete disable
const disabledUsage = new UsagePlugin({
  strategy: 'silent',
  enabled: false
});

// No cost tracking
const noCostUsage = new UsagePlugin({
  strategy: 'memory',
  trackCosts: false,
  aggregateStats: false
});
```

---

## ConversationHistoryPlugin

### Storage Strategy Examples
```typescript
import { ConversationHistoryPlugin } from '@robota-sdk/agents';

// Memory storage (development)
const memoryHistory = new ConversationHistoryPlugin({
  storage: 'memory',
  maxConversations: 10,
  maxMessagesPerConversation: 100,
  autoSave: true
});

// File storage (production)
const fileHistory = new ConversationHistoryPlugin({
  storage: 'file',
  filePath: './conversations.json',
  maxConversations: 1000,
  maxMessagesPerConversation: 1000,
  autoSave: true,
  saveInterval: 30000
});

// Database storage (enterprise)
const dbHistory = new ConversationHistoryPlugin({
  storage: 'database',
  connectionString: 'postgresql://user:pass@localhost/db',
  maxConversations: 10000,
  maxMessagesPerConversation: 5000,
  autoSave: false,
  saveInterval: 60000
});
```

### Disable Options
```typescript
// Complete disable
const disabledHistory = new ConversationHistoryPlugin({
  storage: 'memory',
  enabled: false
});

// Manual save only
const manualHistory = new ConversationHistoryPlugin({
  storage: 'memory',
  autoSave: false,
  maxConversations: 0, // No automatic cleanup
  maxMessagesPerConversation: 0
});
```

---

## ErrorHandlingPlugin

### Strategy Examples
```typescript
import { ErrorHandlingPlugin } from '@robota-sdk/agents';

// Simple retry (basic)
const simpleErrorHandler = new ErrorHandlingPlugin({
  strategy: 'simple',
  maxRetries: 3,
  retryDelay: 1000,
  logErrors: true
});

// Circuit breaker (high availability)
const circuitBreakerHandler = new ErrorHandlingPlugin({
  strategy: 'circuit-breaker',
  maxRetries: 5,
  retryDelay: 2000,
  failureThreshold: 10,
  circuitBreakerTimeout: 60000,
  logErrors: true
});

// Exponential backoff (API rate limits)
const backoffHandler = new ErrorHandlingPlugin({
  strategy: 'exponential-backoff',
  maxRetries: 5,
  retryDelay: 1000, // Initial delay
  logErrors: true
});

// Custom error handling
const customHandler = new ErrorHandlingPlugin({
  strategy: 'simple',
  maxRetries: 3,
  customErrorHandler: async (error, context) => {
    // Send to monitoring service
    await sendToMonitoring(error, context);
    
    // Custom recovery logic
    if (error.message.includes('rate limit')) {
      await sleep(5000);
    }
  }
});
```

### Disable Options
```typescript
// Complete disable
const disabledErrorHandler = new ErrorHandlingPlugin({
  strategy: 'silent',
  enabled: false
});

// No retries
const noRetryHandler = new ErrorHandlingPlugin({
  strategy: 'simple',
  maxRetries: 0,
  logErrors: false
});
```

---

## LimitsPlugin

### Strategy Examples
```typescript
import { LimitsPlugin } from '@robota-sdk/agents';

// Token bucket (smooth rate limiting)
const tokenBucketLimits = new LimitsPlugin({
  strategy: 'token-bucket',
  maxTokens: 100000,
  maxRequests: 1000,
  maxCost: 10.0,
  bucketSize: 10000,
  refillRate: 100, // tokens per second
  tokenCostPer1000: 0.002
});

// Sliding window (precise rate limiting)
const slidingWindowLimits = new LimitsPlugin({
  strategy: 'sliding-window',
  maxTokens: 50000,
  maxRequests: 500,
  timeWindow: 3600000, // 1 hour
  maxCost: 5.0,
  tokenCostPer1000: 0.001
});

// Fixed window (simple rate limiting)
const fixedWindowLimits = new LimitsPlugin({
  strategy: 'fixed-window',
  maxTokens: 25000,
  maxRequests: 250,
  timeWindow: 3600000, // 1 hour
  maxCost: 2.5
});
```

### Disable Options
```typescript
// Complete disable
const disabledLimits = new LimitsPlugin({
  strategy: 'none',
  enabled: false
});

// No limits strategy
const noLimits = new LimitsPlugin({
  strategy: 'none'
});
```

---

## PerformancePlugin

### Strategy Examples
```typescript
import { PerformancePlugin } from '@robota-sdk/agents';

// Memory monitoring (development)
const memoryPerformance = new PerformancePlugin({
  strategy: 'memory',
  maxEntries: 1000,
  monitorMemory: true,
  monitorCPU: true,
  monitorNetwork: false,
  performanceThreshold: 1000,
  aggregateStats: true
});

// File monitoring (production)
const filePerformance = new PerformancePlugin({
  strategy: 'file',
  filePath: './performance-metrics.json',
  maxEntries: 5000,
  monitorMemory: true,
  monitorCPU: true,
  monitorNetwork: true,
  batchSize: 100,
  flushInterval: 30000,
  aggregationInterval: 60000
});

// Prometheus monitoring (enterprise)
const prometheusPerformance = new PerformancePlugin({
  strategy: 'prometheus',
  prometheusEndpoint: '/metrics',
  monitorMemory: true,
  monitorCPU: true,
  monitorNetwork: true,
  performanceThreshold: 500
});
```

### Disable Options
```typescript
// Complete disable
const disabledPerformance = new PerformancePlugin({
  strategy: 'silent',
  enabled: false
});

// Minimal monitoring
const minimalPerformance = new PerformancePlugin({
  strategy: 'memory',
  monitorMemory: false,
  monitorCPU: false,
  monitorNetwork: false,
  aggregateStats: false,
  maxEntries: 0
});
```

---

## ExecutionAnalyticsPlugin

### Configuration Examples
```typescript
import { ExecutionAnalyticsPlugin } from '@robota-sdk/agents';

// Basic analytics
const basicAnalytics = new ExecutionAnalyticsPlugin({
  enabled: true,
  maxEntries: 1000,
  trackErrors: true,
  performanceThreshold: 5000,
  enableWarnings: true
});

// High-throughput analytics
const highThroughputAnalytics = new ExecutionAnalyticsPlugin({
  enabled: true,
  maxEntries: 10000,
  trackErrors: true,
  performanceThreshold: 2000,
  enableWarnings: false // Reduce noise
});
```

### Disable Options
```typescript
// Complete disable
const disabledAnalytics = new ExecutionAnalyticsPlugin({
  enabled: false
});

// Minimal analytics
const minimalAnalytics = new ExecutionAnalyticsPlugin({
  maxEntries: 0, // No history
  trackErrors: false,
  enableWarnings: false
});
```

---

## WebhookPlugin

### Configuration Examples
```typescript
import { WebhookPlugin } from '@robota-sdk/agents';

// Basic webhook
const basicWebhook = new WebhookPlugin({
  endpoints: [
    {
      url: 'https://api.example.com/webhooks/agent',
      events: ['execution.complete', 'error.occurred']
    }
  ],
  defaultTimeout: 5000,
  defaultRetries: 3
});

// Advanced webhook with batching
const advancedWebhook = new WebhookPlugin({
  endpoints: [
    {
      url: 'https://api.example.com/webhooks/agent',
      events: ['execution.complete'],
      headers: {
        'Authorization': 'Bearer your-token'
      },
      timeout: 10000,
      retries: 5
    }
  ],
  batching: {
    enabled: true,
    maxSize: 10,
    flushInterval: 5000
  },
  maxConcurrency: 5,
  payloadTransformer: (event, data) => ({
    timestamp: new Date().toISOString(),
    event,
    payload: data,
    source: 'robota-agent'
  })
});
```

### Disable Options
```typescript
// Complete disable
const disabledWebhook = new WebhookPlugin({
  endpoints: [],
  enabled: false
});

// No events
const noEventsWebhook = new WebhookPlugin({
  endpoints: [
    {
      url: 'https://api.example.com/webhooks/agent',
      events: [] // No events
    }
  ]
});
```

---

## Complete Agent Configuration Examples

### Development Configuration
```typescript
import { Robota } from '@robota-sdk/agents';
import {
  LoggingPlugin,
  EventEmitterPlugin,
  ExecutionAnalyticsPlugin,
  ConversationHistoryPlugin,
  ErrorHandlingPlugin
} from '@robota-sdk/agents';

const developmentAgent = new Robota({
  plugins: [
    new LoggingPlugin({
      strategy: 'console',
      level: 'debug',
      includeStackTrace: true
    }),
    new EventEmitterPlugin({
      events: ['execution.start', 'execution.complete', 'execution.error'],
      async: true,
      catchErrors: true
    }),
    new ExecutionAnalyticsPlugin({
      maxEntries: 100,
      trackErrors: true,
      enableWarnings: true
    }),
    new ConversationHistoryPlugin({
      storage: 'memory',
      maxConversations: 10,
      maxMessagesPerConversation: 100
    }),
    new ErrorHandlingPlugin({
      strategy: 'simple',
      maxRetries: 2,
      logErrors: true
    })
  ]
});
```

### Production Configuration
```typescript
const productionAgent = new Robota({
  plugins: [
    new LoggingPlugin({
      strategy: 'file',
      level: 'warn',
      filePath: './logs/agent.log',
      maxLogs: 100000,
      batchSize: 200,
      flushInterval: 60000
    }),
    new UsagePlugin({
      strategy: 'file',
      filePath: './usage-stats.json',
      trackCosts: true,
      maxEntries: 50000,
      batchSize: 100,
      flushInterval: 300000
    }),
    new ConversationHistoryPlugin({
      storage: 'file',
      filePath: './conversations.json',
      maxConversations: 10000,
      maxMessagesPerConversation: 1000,
      autoSave: true
    }),
    new ErrorHandlingPlugin({
      strategy: 'circuit-breaker',
      maxRetries: 5,
      failureThreshold: 10,
      circuitBreakerTimeout: 60000,
      logErrors: true
    }),
    new LimitsPlugin({
      strategy: 'sliding-window',
      maxTokens: 1000000,
      maxRequests: 10000,
      timeWindow: 3600000,
      maxCost: 100.0
    }),
    new PerformancePlugin({
      strategy: 'file',
      filePath: './performance-metrics.json',
      monitorMemory: true,
      monitorCPU: true,
      performanceThreshold: 2000
    })
  ]
});
```

### Minimal Configuration (Performance Critical)
```typescript
const minimalAgent = new Robota({
  plugins: [
    new LoggingPlugin({
      strategy: 'silent',
      enabled: false
    }),
    new ErrorHandlingPlugin({
      strategy: 'simple',
      maxRetries: 1,
      logErrors: false
    })
  ]
});
```

### Monitoring Configuration (Enterprise)
```typescript
const monitoringAgent = new Robota({
  plugins: [
    new LoggingPlugin({
      strategy: 'remote',
      level: 'info',
      remoteEndpoint: 'https://logs.company.com/api/logs',
      remoteHeaders: {
        'Authorization': 'Bearer log-token'
      }
    }),
    new UsagePlugin({
      strategy: 'remote',
      remoteEndpoint: 'https://analytics.company.com/api/usage',
      remoteHeaders: {
        'API-Key': 'usage-key'
      }
    }),
    new PerformancePlugin({
      strategy: 'prometheus',
      prometheusEndpoint: '/metrics',
      monitorMemory: true,
      monitorCPU: true,
      monitorNetwork: true
    }),
    new WebhookPlugin({
      endpoints: [
        {
          url: 'https://alerts.company.com/webhooks/agent',
          events: ['execution.error', 'error.occurred'],
          headers: {
            'Authorization': 'Bearer webhook-token'
          }
        }
      ]
    }),
    new EventEmitterPlugin({
      events: ['execution.complete', 'error.occurred'],
      buffer: {
        enabled: true,
        maxSize: 100,
        flushInterval: 10000
      }
    })
  ]
});
``` 