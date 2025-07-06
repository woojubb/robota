# Module System Integration

Learn how to use the enhanced Plugin-Module-Separation architecture in Robota SDK.

## Overview

The Robota SDK now features a comprehensive Plugin-Module-Separation architecture that provides:

- **Enhanced Plugin System**: Classification, priorities, and module event subscription
- **Module Infrastructure**: BaseModule, ModuleRegistry, and ModuleTypeRegistry
- **Event-Driven Communication**: Loose coupling between modules and plugins
- **Backward Compatibility**: All existing plugins work without modification

## Plugin Classification System

### Plugin Categories and Priorities

```typescript
import { 
    Robota, 
    LoggingPlugin, 
    PerformancePlugin, 
    UsagePlugin,
    PluginCategory,
    PluginPriority
} from '@robota-sdk/agents';

// Plugins are automatically classified with categories and priorities
const plugins = [
    new LoggingPlugin({           // [LOGGING/HIGH]
        level: 'info',
        moduleEvents: ['module.initialize.complete', 'module.execution.complete']
    }),
    new PerformancePlugin({       // [MONITORING/NORMAL]
        moduleEvents: ['module.execution.start', 'module.execution.complete']
    }),
    new UsagePlugin({            // [MONITORING/NORMAL]
        moduleEvents: ['module.execution.complete']
    })
];

// Create agent with enhanced plugins
const agent = new Robota({
    name: 'ClassifiedAgent',
    model: 'gpt-4',
    provider: 'openai',
    aiProviders: { openai: openaiProvider },
    plugins,
    systemMessage: 'You are an AI agent with enhanced monitoring capabilities.'
});
```

### Module Event Subscription

Plugins can now subscribe to module lifecycle events:

```typescript
// LoggingPlugin will automatically log module activities
const loggingPlugin = new LoggingPlugin({
    level: 'info',
    // Subscribe to specific module events
    moduleEvents: [
        'module.initialize.start',
        'module.initialize.complete',
        'module.execution.start',
        'module.execution.complete',
        'module.execution.error',
        'module.dispose.complete'
    ],
    // Or subscribe to all module events
    subscribeToAllModuleEvents: false
});

// PerformancePlugin will track module performance
const performancePlugin = new PerformancePlugin({
    moduleEvents: ['module.execution.start', 'module.execution.complete']
});

// UsagePlugin will track module usage statistics
const usagePlugin = new UsagePlugin({
    moduleEvents: ['module.execution.complete']
});
```

## Creating Custom Modules

### Basic Module Implementation

```typescript
import { BaseModule, ModuleExecutionContext, ModuleExecutionResult } from '@robota-sdk/agents';

class StorageModule extends BaseModule {
    readonly name = 'StorageModule';
    readonly version = '1.0.0';
    readonly moduleType = 'storage';
    
    private storage: Map<string, any> = new Map();
    
    constructor(options: any, eventEmitter?: EventEmitter) {
        super(options, eventEmitter);
        
        // Declare module capabilities
        this.capabilities = ['data-storage', 'data-retrieval'];
        this.dependencies = []; // No dependencies for this module
    }
    
    async initialize(): Promise<void> {
        this.emitModuleEvent('initialize.start', {
            moduleName: this.name,
            moduleType: this.moduleType,
            executionId: this.generateExecutionId()
        });
        
        // Initialize storage
        this.storage.clear();
        console.log('Storage module initialized');
        
        this.emitModuleEvent('initialize.complete', {
            moduleName: this.name,
            moduleType: this.moduleType,
            executionId: this.lastExecutionId,
            duration: Date.now() - this.startTime
        });
    }
    
    async execute<T>(context: ModuleExecutionContext): Promise<ModuleExecutionResult<T>> {
        this.emitModuleEvent('execution.start', {
            moduleName: this.name,
            moduleType: this.moduleType,
            executionId: this.generateExecutionId(),
            context
        });
        
        try {
            const { operation, key, value } = context;
            let result: any;
            
            switch (operation) {
                case 'store':
                    this.storage.set(key, value);
                    result = { success: true, key, value };
                    break;
                case 'retrieve':
                    result = { success: true, key, value: this.storage.get(key) };
                    break;
                case 'delete':
                    const deleted = this.storage.delete(key);
                    result = { success: deleted, key };
                    break;
                default:
                    throw new Error(`Unknown operation: ${operation}`);
            }
            
            this.emitModuleEvent('execution.complete', {
                moduleName: this.name,
                moduleType: this.moduleType,
                executionId: this.lastExecutionId,
                duration: Date.now() - this.startTime,
                success: true,
                result
            });
            
            return { success: true, data: result as T };
        } catch (error) {
            this.emitModuleEvent('execution.error', {
                moduleName: this.name,
                moduleType: this.moduleType,
                executionId: this.lastExecutionId,
                duration: Date.now() - this.startTime,
                success: false,
                error: error.message
            });
            
            return { success: false, error: error.message };
        }
    }
    
    async dispose(): Promise<void> {
        this.storage.clear();
        console.log('Storage module disposed');
        
        this.emitModuleEvent('dispose.complete', {
            moduleName: this.name,
            moduleType: this.moduleType,
            executionId: this.generateExecutionId()
        });
    }
    
    getStats() {
        return {
            executionCount: this.executionCount,
            averageExecutionTime: this.averageExecutionTime,
            lastExecution: this.lastExecution,
            storageSize: this.storage.size
        };
    }
}
```

### Advanced Module with Dependencies

```typescript
class ProcessingModule extends BaseModule {
    readonly name = 'ProcessingModule';
    readonly version = '1.0.0';
    readonly moduleType = 'processing';
    
    constructor(options: any, eventEmitter?: EventEmitter) {
        super(options, eventEmitter);
        
        this.capabilities = ['data-processing', 'transformation'];
        this.dependencies = ['StorageModule']; // Depends on storage module
    }
    
    async initialize(): Promise<void> {
        this.emitModuleEvent('initialize.start', {
            moduleName: this.name,
            moduleType: this.moduleType,
            executionId: this.generateExecutionId()
        });
        
        // Initialize processing resources
        console.log('Processing module initialized');
        
        this.emitModuleEvent('initialize.complete', {
            moduleName: this.name,
            moduleType: this.moduleType,
            executionId: this.lastExecutionId,
            duration: Date.now() - this.startTime
        });
    }
    
    async execute<T>(context: ModuleExecutionContext): Promise<ModuleExecutionResult<T>> {
        this.emitModuleEvent('execution.start', {
            moduleName: this.name,
            moduleType: this.moduleType,
            executionId: this.generateExecutionId(),
            context
        });
        
        try {
            const { data, operation } = context;
            
            // Process data based on operation
            const processedData = await this.processData(data, operation);
            
            this.emitModuleEvent('execution.complete', {
                moduleName: this.name,
                moduleType: this.moduleType,
                executionId: this.lastExecutionId,
                duration: Date.now() - this.startTime,
                success: true,
                result: processedData
            });
            
            return { success: true, data: processedData as T };
        } catch (error) {
            this.emitModuleEvent('execution.error', {
                moduleName: this.name,
                moduleType: this.moduleType,
                executionId: this.lastExecutionId,
                error: error.message
            });
            
            return { success: false, error: error.message };
        }
    }
    
    private async processData(data: any, operation: string): Promise<any> {
        // Simulate data processing
        switch (operation) {
            case 'transform':
                return { ...data, processed: true, timestamp: Date.now() };
            case 'validate':
                return { valid: true, data };
            default:
                return data;
        }
    }
}
```

## Module Registry Usage

### Setting Up Module Registry

```typescript
import { ModuleRegistry, ModuleTypeRegistry } from '@robota-sdk/agents';

class ModularAgent extends Robota {
    private moduleRegistry: ModuleRegistry;
    
    constructor() {
        // Create monitoring plugins
        const loggingPlugin = new LoggingPlugin({
            level: 'info',
            moduleEvents: ['module.initialize.complete', 'module.execution.complete']
        });
        
        const performancePlugin = new PerformancePlugin({
            moduleEvents: ['module.execution.start', 'module.execution.complete']
        });
        
        super({
            name: 'ModularAgent',
            model: 'gpt-4',
            provider: 'openai',
            aiProviders: { openai: openaiProvider },
            plugins: [loggingPlugin, performancePlugin],
            systemMessage: 'You are a modular AI agent with enhanced capabilities.'
        });
        
        // Initialize module registry with shared EventEmitter
        this.moduleRegistry = new ModuleRegistry(this.eventEmitter);
        
        this.setupModules();
    }
    
    private async setupModules(): Promise<void> {
        // Register modules
        const storageModule = new StorageModule({
            enabled: true,
            config: { maxSize: 1000 }
        }, this.eventEmitter);
        
        const processingModule = new ProcessingModule({
            enabled: true,
            config: { maxConcurrency: 5 }
        }, this.eventEmitter);
        
        await this.moduleRegistry.registerModule(storageModule);
        await this.moduleRegistry.registerModule(processingModule);
        
        // Initialize all modules (dependency order is handled automatically)
        await this.moduleRegistry.initializeModules();
    }
    
    async storeData(key: string, value: any): Promise<any> {
        return this.moduleRegistry.executeModule('StorageModule', {
            operation: 'store',
            key,
            value
        });
    }
    
    async retrieveData(key: string): Promise<any> {
        return this.moduleRegistry.executeModule('StorageModule', {
            operation: 'retrieve',
            key
        });
    }
    
    async processData(data: any, operation: string): Promise<any> {
        return this.moduleRegistry.executeModule('ProcessingModule', {
            data,
            operation
        });
    }
    
    getModuleStats(): any {
        return this.moduleRegistry.getStats();
    }
}
```

## Complete Example

### Full Integration Example

```typescript
import { 
    Robota, 
    BaseModule, 
    ModuleRegistry,
    LoggingPlugin, 
    PerformancePlugin, 
    UsagePlugin,
    ExecutionAnalyticsPlugin
} from '@robota-sdk/agents';

// Create a comprehensive example
async function createModularAgent() {
    // Create monitoring plugins that will track module activities
    const loggingPlugin = new LoggingPlugin({
        level: 'info',
        moduleEvents: [
            'module.initialize.complete',
            'module.execution.complete',
            'module.execution.error'
        ]
    });
    
    const performancePlugin = new PerformancePlugin({
        moduleEvents: ['module.execution.start', 'module.execution.complete']
    });
    
    const usagePlugin = new UsagePlugin({
        moduleEvents: ['module.execution.complete']
    });
    
    const analyticsPlugin = new ExecutionAnalyticsPlugin({
        trackErrors: true,
        maxEntries: 1000
    });
    
    // Create agent with all monitoring plugins
    const agent = new Robota({
        name: 'ComprehensiveModularAgent',
        model: 'gpt-4',
        provider: 'openai',
        aiProviders: { openai: openaiProvider },
        plugins: [loggingPlugin, performancePlugin, usagePlugin, analyticsPlugin],
        systemMessage: 'You are a comprehensive modular AI agent with full monitoring capabilities.'
    });
    
    // Initialize module registry with shared EventEmitter
    const moduleRegistry = new ModuleRegistry(agent.eventEmitter);
    
    // Create and register modules
    const storageModule = new StorageModule({
        enabled: true,
        config: { maxSize: 1000 }
    }, agent.eventEmitter);
    
    const processingModule = new ProcessingModule({
        enabled: true,
        config: { maxConcurrency: 5 }
    }, agent.eventEmitter);
    
    await moduleRegistry.registerModule(storageModule);
    await moduleRegistry.registerModule(processingModule);
    
    // Initialize modules
    await moduleRegistry.initializeModules();
    
    return { agent, moduleRegistry };
}

// Usage example
async function runExample() {
    const { agent, moduleRegistry } = await createModularAgent();
    
    // Store some data
    const storeResult = await moduleRegistry.executeModule('StorageModule', {
        operation: 'store',
        key: 'user_data',
        value: { name: 'John', age: 30 }
    });
    
    console.log('Store result:', storeResult);
    
    // Process some data
    const processResult = await moduleRegistry.executeModule('ProcessingModule', {
        data: { raw: 'data' },
        operation: 'transform'
    });
    
    console.log('Process result:', processResult);
    
    // Use the agent for conversation
    const response = await agent.run('Analyze the data processing capabilities');
    console.log('Agent response:', response);
    
    // Get comprehensive statistics
    console.log('Module stats:', moduleRegistry.getStats());
    console.log('Agent stats:', agent.getStats());
    
    // Get plugin statistics
    const plugins = agent.getPlugins();
    plugins.forEach(plugin => {
        console.log(`${plugin.name} stats:`, plugin.getStats());
    });
}

// Run the example
runExample().catch(console.error);
```

## Key Benefits

### 1. Event-Driven Architecture
- **Loose Coupling**: Modules and plugins don't directly depend on each other
- **Automatic Monitoring**: Plugins automatically monitor module activities
- **Extensibility**: Easy to add new modules and plugins

### 2. Enhanced Plugin System
- **Classification**: Plugins are categorized and prioritized
- **Module Awareness**: Plugins can subscribe to module events
- **Backward Compatibility**: All existing plugins work without changes

### 3. Type Safety
- **Complete TypeScript Support**: Full type safety throughout the system
- **Generic Parameters**: Flexible type system for custom modules and plugins
- **Runtime Validation**: Type checking at runtime

### 4. Performance Monitoring
- **Comprehensive Metrics**: Module execution times, success rates, error tracking
- **Plugin Statistics**: Detailed plugin performance data
- **System Analytics**: Overall system performance insights

## Best Practices

1. **Module Design**: Keep modules focused on single responsibilities
2. **Event Usage**: Use module events for monitoring, not business logic
3. **Dependency Management**: Declare dependencies explicitly
4. **Error Handling**: Implement proper error handling in modules
5. **Performance**: Monitor module performance and optimize as needed
6. **Testing**: Write comprehensive tests for custom modules
7. **Documentation**: Document module capabilities and usage patterns 