# Plugin Automatic Behaviors and Default Policies

This document details the automatic behaviors, default settings, and disable options for all plugins in the `@robota-sdk/agents` package.

## Overview

All plugins in the Robota SDK follow these principles:
- **Explicit Configuration**: All automatic behaviors can be controlled through configuration
- **Disable Options**: Every plugin provides clear ways to disable automatic behaviors
- **No Arbitrary Decisions**: Plugins avoid making policy decisions without explicit configuration
- **Clear Error Messages**: When limits or errors occur, plugins provide actionable error messages

## Plugin Categories

### 🔄 Event Processing
- **EventEmitterPlugin**: Event detection and propagation

### 📊 Monitoring
- **ExecutionAnalyticsPlugin**: Performance tracking
- **PerformancePlugin**: System metrics monitoring
- **UsagePlugin**: Usage statistics collection

### 📝 Logging
- **LoggingPlugin**: Operation logging

### 💾 Storage
- **ConversationHistoryPlugin**: Conversation persistence

### ⚠️ Error Handling
- **ErrorHandlingPlugin**: Error recovery and retry mechanisms

### 🚦 Limits
- **LimitsPlugin**: Rate limiting and resource control

### 🔔 Notification
- **WebhookPlugin**: External notifications

---

## Detailed Plugin Behaviors

### EventEmitterPlugin
**Category**: Event Processing | **Priority**: HIGH

#### Automatic Behaviors
- **Event Detection**: Automatically detects and emits lifecycle events
- **Error Handling**: Catches and re-emits handler errors as `plugin.error` events
- **One-time Handlers**: Automatically removes handlers marked with `once: true`
- **Event Buffering**: Optionally buffers events for batch processing

#### Default Settings
```typescript
{
  enabled: true,
  events: [
    'execution.start', 'execution.complete', 'execution.error',
    'tool.beforeExecute', 'tool.afterExecute', 'tool.success', 'tool.error'
  ],
  maxListeners: 100,
  async: true,
  catchErrors: true,
  buffer: { enabled: false, maxSize: 1000, flushInterval: 5000 }
}
```

#### Disable Options
- **Complete Disable**: `enabled: false`
- **Selective Events**: `events: []` (empty array)
- **Error Propagation**: `catchErrors: false`
- **Synchronous Mode**: `async: false`

#### Policy Decisions Made
- ✅ **Clear**: Event filtering based on explicit `events` array
- ✅ **Clear**: Error handling based on `catchErrors` setting
- ❌ **None**: No arbitrary policy decisions

---

### ExecutionAnalyticsPlugin
**Category**: Monitoring | **Priority**: NORMAL

#### Automatic Behaviors
- **Performance Tracking**: Automatically tracks execution times and success rates
- **Memory Management**: Automatically trims history when `maxEntries` is exceeded
- **Warning Generation**: Emits warnings when execution time exceeds `performanceThreshold`
- **Statistics Aggregation**: Automatically calculates aggregated metrics

#### Default Settings
```typescript
{
  enabled: true,
  maxEntries: 1000,
  trackErrors: true,
  performanceThreshold: 5000, // 5 seconds
  enableWarnings: true
}
```

#### Disable Options
- **Complete Disable**: `enabled: false`
- **Error Tracking**: `trackErrors: false`
- **Warnings**: `enableWarnings: false`
- **History Limit**: `maxEntries: 0` (no history retention)

#### Policy Decisions Made
- ✅ **Clear**: History trimming based on explicit `maxEntries`
- ✅ **Clear**: Warning thresholds based on `performanceThreshold`
- ❌ **None**: No arbitrary cleanup or optimization decisions

---

### UsagePlugin
**Category**: Monitoring | **Priority**: NORMAL

#### Automatic Behaviors
- **Usage Tracking**: Automatically tracks token usage, costs, and API calls
- **Cost Calculation**: Automatically calculates costs based on token usage and rates
- **Statistics Aggregation**: Periodically aggregates usage statistics
- **Data Persistence**: Automatically saves usage data based on strategy

#### Default Settings
```typescript
{
  enabled: true,
  strategy: 'memory', // or 'file', 'remote', 'silent'
  maxEntries: 10000,
  trackCosts: true,
  batchSize: 50,
  flushInterval: 60000, // 1 minute
  aggregateStats: true,
  aggregationInterval: 300000 // 5 minutes
}
```

#### Disable Options
- **Complete Disable**: `enabled: false`
- **Silent Mode**: `strategy: 'silent'`
- **Cost Tracking**: `trackCosts: false`
- **Aggregation**: `aggregateStats: false`

#### Policy Decisions Made
- ✅ **Clear**: Data retention based on explicit `maxEntries`
- ✅ **Clear**: Flush timing based on `flushInterval`
- ❌ **None**: No arbitrary data cleanup or cost optimization

---

### LoggingPlugin
**Category**: Logging | **Priority**: HIGH

#### Automatic Behaviors
- **Log Level Filtering**: Automatically filters logs based on configured level
- **Log Rotation**: Automatically manages log file size when using file strategy
- **Batch Processing**: Automatically batches log entries for performance
- **Stack Trace Inclusion**: Automatically includes stack traces for errors

#### Default Settings
```typescript
{
  enabled: true,
  strategy: 'console', // or 'file', 'remote', 'silent'
  level: 'info',
  filePath: './agent.log',
  maxLogs: 10000,
  includeStackTrace: true,
  batchSize: 100,
  flushInterval: 30000 // 30 seconds
}
```

#### Disable Options
- **Complete Disable**: `enabled: false`
- **Silent Mode**: `strategy: 'silent'`
- **Stack Traces**: `includeStackTrace: false`
- **Minimal Logging**: `level: 'error'` (only errors)

#### Policy Decisions Made
- ✅ **Clear**: Log retention based on explicit `maxLogs`
- ✅ **Clear**: Level filtering based on `level` setting
- ❌ **None**: No arbitrary log cleanup or filtering decisions

---

### ConversationHistoryPlugin
**Category**: Storage | **Priority**: HIGH

#### Automatic Behaviors
- **Message Persistence**: Automatically saves conversation messages
- **History Trimming**: Automatically trims conversations when limits are exceeded
- **Batch Saving**: Optionally batches saves for performance
- **Auto-Save**: Automatically saves messages immediately or on intervals

#### Default Settings
```typescript
{
  enabled: true,
  storage: 'memory', // or 'file', 'database'
  maxConversations: 100,
  maxMessagesPerConversation: 1000,
  filePath: './conversations.json',
  autoSave: true,
  saveInterval: 30000 // 30 seconds
}
```

#### Disable Options
- **Complete Disable**: `enabled: false`
- **Manual Save**: `autoSave: false`
- **No Limits**: `maxConversations: 0`, `maxMessagesPerConversation: 0`

#### Policy Decisions Made
- ✅ **Clear**: Message trimming based on explicit limits
- ✅ **Clear**: Save timing based on `autoSave` and `saveInterval`
- ❌ **None**: No arbitrary conversation cleanup or archiving

---

### ErrorHandlingPlugin
**Category**: Error Handling | **Priority**: HIGH

#### Automatic Behaviors
- **Retry Logic**: Automatically retries failed operations based on strategy
- **Circuit Breaker**: Automatically opens circuit breaker after failure threshold
- **Exponential Backoff**: Automatically calculates retry delays
- **Error Logging**: Automatically logs errors when enabled

#### Default Settings
```typescript
{
  enabled: true,
  strategy: 'simple', // or 'circuit-breaker', 'exponential-backoff', 'silent'
  maxRetries: 3,
  retryDelay: 1000,
  logErrors: true,
  failureThreshold: 5,
  circuitBreakerTimeout: 60000 // 1 minute
}
```

#### Disable Options
- **Complete Disable**: `enabled: false`
- **Silent Mode**: `strategy: 'silent'`
- **No Retries**: `maxRetries: 0`
- **No Logging**: `logErrors: false`

#### Policy Decisions Made
- ✅ **Clear**: Retry behavior based on explicit strategy and limits
- ✅ **Clear**: Circuit breaker timing based on configured thresholds
- ❌ **None**: No arbitrary error recovery decisions

---

### LimitsPlugin
**Category**: Limits | **Priority**: NORMAL

#### Automatic Behaviors
- **Rate Limiting**: Automatically enforces request and token limits
- **Cost Monitoring**: Automatically tracks and limits costs
- **Token Bucket Refill**: Automatically refills token buckets at configured rate
- **Window Reset**: Automatically resets sliding/fixed windows

#### Default Settings
```typescript
{
  enabled: true,
  strategy: 'none', // or 'token-bucket', 'sliding-window', 'fixed-window'
  maxTokens: 100000,
  maxRequests: 1000,
  timeWindow: 3600000, // 1 hour
  maxCost: 10.0,
  tokenCostPer1000: 0.002,
  refillRate: 100, // tokens per second
  bucketSize: 10000
}
```

#### Disable Options
- **Complete Disable**: `enabled: false`
- **No Limits**: `strategy: 'none'`
- **Unlimited Tokens**: `maxTokens: Infinity`
- **Unlimited Requests**: `maxRequests: Infinity`

#### Policy Decisions Made
- ✅ **Clear**: Limit enforcement based on explicit strategy and thresholds
- ✅ **Clear**: Rate limiting based on configured parameters
- ❌ **None**: No arbitrary resource management decisions

---

### PerformancePlugin
**Category**: Monitoring | **Priority**: NORMAL

#### Automatic Behaviors
- **Metrics Collection**: Automatically collects system performance metrics
- **Data Aggregation**: Automatically aggregates performance statistics
- **Threshold Monitoring**: Automatically detects performance issues
- **Data Persistence**: Automatically saves metrics based on strategy

#### Default Settings
```typescript
{
  enabled: true,
  strategy: 'memory', // or 'file', 'remote', 'prometheus'
  maxEntries: 5000,
  monitorMemory: true,
  monitorCPU: true,
  monitorNetwork: false,
  batchSize: 100,
  flushInterval: 30000,
  aggregateStats: true,
  aggregationInterval: 60000,
  performanceThreshold: 1000 // 1 second
}
```

#### Disable Options
- **Complete Disable**: `enabled: false`
- **Selective Monitoring**: `monitorMemory: false`, `monitorCPU: false`
- **No Aggregation**: `aggregateStats: false`
- **No Persistence**: `strategy: 'memory'` with `maxEntries: 0`

#### Policy Decisions Made
- ✅ **Clear**: Data retention based on explicit `maxEntries`
- ✅ **Clear**: Monitoring scope based on explicit flags
- ❌ **None**: No arbitrary performance optimization decisions

---

### WebhookPlugin
**Category**: Notification | **Priority**: LOW

#### Automatic Behaviors
- **Event Filtering**: Automatically filters events based on configured list
- **Payload Transformation**: Automatically transforms payloads using configured transformer
- **Retry Logic**: Automatically retries failed webhook deliveries
- **Batch Processing**: Optionally batches webhook deliveries

#### Default Settings
```typescript
{
  enabled: true,
  events: ['execution.complete', 'conversation.complete', 'tool.executed', 'error.occurred'],
  defaultTimeout: 5000,
  defaultRetries: 3,
  async: true,
  maxConcurrency: 3,
  batching: { enabled: false, maxSize: 10, flushInterval: 5000 }
}
```

#### Disable Options
- **Complete Disable**: `enabled: false`
- **No Events**: `events: []`
- **No Retries**: `defaultRetries: 0`
- **Synchronous**: `async: false`

#### Policy Decisions Made
- ✅ **Clear**: Event filtering based on explicit `events` array
- ✅ **Clear**: Retry behavior based on configured parameters
- ❌ **None**: No arbitrary webhook delivery decisions

---

## Best Practices

### Plugin Configuration
1. **Always explicitly configure plugins** - Don't rely on defaults for production
2. **Use disable options** - Prefer explicit disabling over removal
3. **Monitor plugin behavior** - Use logging to understand plugin actions
4. **Test disable scenarios** - Ensure your application works with plugins disabled

### Error Handling
1. **Configure error strategies** - Choose appropriate error handling for your use case
2. **Set appropriate thresholds** - Configure limits based on your requirements
3. **Monitor plugin errors** - Watch for plugin-specific error patterns

### Performance
1. **Tune batch sizes** - Adjust batch processing based on your load
2. **Configure appropriate intervals** - Balance performance with resource usage
3. **Use silent modes** - Disable plugins in performance-critical scenarios

### Security
1. **Limit data retention** - Configure appropriate `maxEntries` values
2. **Secure remote endpoints** - Use proper authentication for remote plugins
3. **Validate configurations** - Ensure plugin configurations meet security requirements 