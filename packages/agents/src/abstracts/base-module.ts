import type { EventEmitterPlugin } from '../plugins/event-emitter-plugin';
import type { EventExecutionContextData, EventExecutionValue } from '../plugins/event-emitter-plugin';
import { Logger, createLogger } from '../utils/logger';

/**
 * Module execution context for all modules
 */
export interface ModuleExecutionContext {
    executionId?: string;
    sessionId?: string;
    userId?: string;
    agentName?: string;
    metadata?: Record<string, string | number | boolean | Date>;
    [key: string]: string | number | boolean | Date | Record<string, string | number | boolean | Date> | undefined;
}

/**
 * Module execution result for all modules
 */
export interface ModuleExecutionResult {
    success: boolean;
    data?: ModuleResultData;
    error?: Error;
    duration?: number;
    metadata?: Record<string, string | number | boolean | Date>;
}

/**
 * Module result data interface
 */
export interface ModuleResultData {
    [key: string]: string | number | boolean | Record<string, string | number | boolean> | undefined;
}

/**
 * Base module options that all module options should extend
 */
export interface BaseModuleOptions {
    /** Whether the module is enabled */
    enabled?: boolean;
    /** Module-specific configuration */
    config?: Record<string, string | number | boolean>;
}

/**
 * Module capabilities that define what the module can do
 */
export interface ModuleCapabilities {
    /** List of capabilities this module provides */
    capabilities: string[];
    /** Dependencies on other modules */
    dependencies?: string[];
    /** Optional capabilities that enhance functionality if available */
    optionalDependencies?: string[];
}

/**
 * Module type descriptor for dynamic type system
 */
export interface ModuleTypeDescriptor {
    /** Unique type identifier */
    type: string;
    /** Module category */
    category: ModuleCategory;
    /** Module layer */
    layer: ModuleLayer;
    /** Required dependencies */
    dependencies?: string[];
    /** Provided capabilities */
    capabilities?: string[];
}

/**
 * Module categories for classification
 */
export enum ModuleCategory {
    /** Core functionality modules */
    CORE = 'core',
    /** Storage and data management */
    STORAGE = 'storage',
    /** Processing and transformation */
    PROCESSING = 'processing',
    /** External integration */
    INTEGRATION = 'integration',
    /** User interface and interaction */
    INTERFACE = 'interface',
    /** Specialized capabilities */
    CAPABILITY = 'capability'
}

/**
 * Module layers for dependency management
 */
export enum ModuleLayer {
    /** Infrastructure layer (lowest) */
    INFRASTRUCTURE = 'infrastructure',
    /** Core services layer */
    CORE = 'core',
    /** Application logic layer */
    APPLICATION = 'application',
    /** Domain-specific layer */
    DOMAIN = 'domain',
    /** Presentation layer (highest) */
    PRESENTATION = 'presentation'
}

/**
 * Module data interface for introspection
 */
export interface ModuleData {
    name: string;
    version: string;
    type: string;
    enabled: boolean;
    initialized: boolean;
    capabilities: ModuleCapabilities;
    metadata?: Record<string, string | number | boolean>;
}

/**
 * Module statistics interface
 */
export interface ModuleStats {
    enabled: boolean;
    initialized: boolean;
    executionCount: number;
    errorCount: number;
    lastActivity?: Date;
    averageExecutionTime?: number;
    [key: string]: string | number | boolean | Date | undefined;
}

/**
 * Type-safe module interface with specific type parameters
 * 
 * @template TOptions - Module options type that extends BaseModuleOptions
 * @template TStats - Module statistics type (defaults to ModuleStats)
 */
export interface TypeSafeModuleInterface<TOptions extends BaseModuleOptions = BaseModuleOptions, TStats = ModuleStats> {
    name: string;
    version: string;
    enabled: boolean;

    initialize(options?: TOptions, eventEmitter?: EventEmitterPlugin): Promise<void>;
    dispose?(): Promise<void>;
    execute?(context: ModuleExecutionContext): Promise<ModuleExecutionResult>;
    getModuleType(): ModuleTypeDescriptor;
    getCapabilities(): ModuleCapabilities;
    getData?(): ModuleData;
    getStats?(): TStats;
}

/**
 * Base module interface extending TypeSafeModuleInterface
 */
export interface BaseModuleInterface extends TypeSafeModuleInterface<BaseModuleOptions, ModuleStats> { }

/**
 * Module lifecycle hooks
 */
export interface ModuleHooks {
    /**
     * Called before module execution
     */
    beforeExecution?(context: ModuleExecutionContext): Promise<void> | void;

    /**
     * Called after module execution
     */
    afterExecution?(context: ModuleExecutionContext, result: ModuleExecutionResult): Promise<void> | void;

    /**
     * Called when module is activated
     */
    onActivate?(): Promise<void> | void;

    /**
     * Called when module is deactivated
     */
    onDeactivate?(): Promise<void> | void;

    /**
     * Called on module error
     */
    onError?(error: Error, context?: ModuleExecutionContext): Promise<void> | void;
}

/**
 * Base abstract class for all modules with type parameter support
 * Provides module lifecycle management and common functionality
 * 
 * ⚠️ 기본 전제 조건: 모든 Module은 선택적 확장 기능이어야 합니다
 * - ✅ Module이 없어도 Robota가 에러 없이 정상 동작
 * - ✅ Module 추가 시 새로운 능력이나 기능 획득  
 * - ❌ Module이 없으면 주요 로직에 문제 발생 → 내부 클래스로 구현
 * 
 * @template TOptions - Module options type that extends BaseModuleOptions
 * @template TStats - Module statistics type (defaults to ModuleStats)
 */
export abstract class BaseModule<TOptions extends BaseModuleOptions = BaseModuleOptions, TStats = ModuleStats>
    implements TypeSafeModuleInterface<TOptions, TStats>, ModuleHooks {

    /** Module name */
    abstract readonly name: string;

    /** Module version */
    abstract readonly version: string;

    /** Module enabled state */
    public enabled = true;

    /** Module initialization state */
    public initialized = false;

    /** Module options */
    protected options: TOptions | undefined;

    /** EventEmitter for module events */
    protected eventEmitter: EventEmitterPlugin | undefined;

    /** Logger instance */
    protected logger: Logger;

    /** Execution statistics */
    protected stats = {
        executionCount: 0,
        errorCount: 0,
        lastActivity: undefined as Date | undefined,
        totalExecutionTime: 0
    };

    constructor() {
        this.logger = createLogger(`Module:${this.constructor.name}`);
    }

    /**
     * Get module type descriptor - must be implemented by each module
     */
    abstract getModuleType(): ModuleTypeDescriptor;

    /**
     * Get module capabilities - must be implemented by each module
     */
    abstract getCapabilities(): ModuleCapabilities;

    /**
     * Initialize the module with type-safe options and EventEmitter
     */
    async initialize(options?: TOptions, eventEmitter?: EventEmitterPlugin): Promise<void> {
        this.options = options;
        this.eventEmitter = eventEmitter;

        // Set enabled state from options with default fallback
        if (options && 'enabled' in options && typeof options.enabled === 'boolean') {
            this.enabled = options.enabled;
        } else {
            this.enabled = true; // Default to enabled
        }

        this.logger.debug('Module initializing', {
            name: this.name,
            version: this.version,
            enabled: this.enabled,
            hasEventEmitter: !!this.eventEmitter
        });

        const startTime = Date.now();

        // Emit module initialization event
        if (this.eventEmitter && this.enabled) {
            const filteredOptions = options ? Object.fromEntries(
                Object.entries(options).filter(([_, value]) =>
                    typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
                )
            ) : undefined;

            const eventData: ModuleInitializationEventData = {
                moduleName: this.name,
                moduleType: this.getModuleType().type,
                phase: 'start',
                timestamp: new Date(),
                ...(filteredOptions && Object.keys(filteredOptions).length > 0 && { options: filteredOptions })
            };

            await this.eventEmitter.emit('module.initialize.start', {
                data: this.convertToEventData(eventData),
                timestamp: new Date()
            });
        }

        try {
            // Call custom initialization logic
            await this.onInitialize(options);

            this.initialized = true;

            // Emit successful initialization
            if (this.eventEmitter && this.enabled) {
                const eventData: ModuleInitializationEventData = {
                    moduleName: this.name,
                    moduleType: this.getModuleType().type,
                    phase: 'complete',
                    timestamp: new Date(),
                    duration: Date.now() - startTime
                };

                await this.eventEmitter.emit('module.initialize.complete', {
                    data: this.convertToEventData(eventData),
                    timestamp: new Date()
                });
            }

            this.logger.info('Module initialized successfully', {
                name: this.name,
                type: this.getModuleType().type
            });

        } catch (error) {
            this.initialized = false;

            // Emit initialization error
            if (this.eventEmitter) {
                const eventData: ModuleInitializationEventData = {
                    moduleName: this.name,
                    moduleType: this.getModuleType().type,
                    phase: 'error',
                    timestamp: new Date(),
                    duration: Date.now() - startTime,
                    error: error instanceof Error ? error.message : String(error)
                };

                await this.eventEmitter.emit('module.initialize.error', {
                    data: this.convertToEventData(eventData),
                    error: error instanceof Error ? error : new Error(String(error)),
                    timestamp: new Date()
                });
            }

            this.logger.error('Module initialization failed', {
                name: this.name,
                error: error instanceof Error ? error.message : String(error)
            });

            throw error;
        }
    }

    /**
     * Custom initialization logic - can be overridden by modules
     */
    protected async onInitialize(_options?: TOptions): Promise<void> {
        // Default implementation - can be overridden
    }

    /**
     * Execute module functionality
     */
    async execute(context: ModuleExecutionContext): Promise<ModuleExecutionResult> {
        if (!this.enabled) {
            throw new Error(`Module ${this.name} is disabled`);
        }

        if (!this.initialized) {
            throw new Error(`Module ${this.name} is not initialized`);
        }

        const startTime = Date.now();
        const executionId = context.executionId || `exec_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

        // Emit execution start event
        if (this.eventEmitter) {
            const contextData: Record<string, string> = {};
            if (context['sessionId']) contextData['sessionId'] = context['sessionId'];
            if (context['userId']) contextData['userId'] = context['userId'];
            if (context['agentName']) contextData['agentName'] = context['agentName'];

            const eventData: ModuleExecutionEventData = {
                moduleName: this.name,
                moduleType: this.getModuleType().type,
                phase: 'start',
                executionId,
                timestamp: new Date(),
                inputSize: JSON.stringify(context).length,
                ...(Object.keys(contextData).length > 0 && { context: contextData })
            };

            await this.eventEmitter.emit('module.execution.start', {
                data: this.convertToEventData(eventData),
                timestamp: new Date()
            });
        }

        try {
            // Call before execution hook
            await this.beforeExecution?.(context);

            // Execute module logic
            const result = await this.onExecute(context);

            const duration = Date.now() - startTime;

            // Update statistics
            this.stats.executionCount++;
            this.stats.lastActivity = new Date();
            this.stats.totalExecutionTime += duration;

            const finalResult = {
                ...result,
                duration
            };

            // Call after execution hook
            await this.afterExecution?.(context, finalResult);

            // Emit execution complete event
            if (this.eventEmitter) {
                const contextData: Record<string, string> = {};
                if (context['sessionId']) contextData['sessionId'] = context['sessionId'];
                if (context['userId']) contextData['userId'] = context['userId'];
                if (context['agentName']) contextData['agentName'] = context['agentName'];

                const eventData: ModuleExecutionEventData = {
                    moduleName: this.name,
                    moduleType: this.getModuleType().type,
                    phase: 'complete',
                    executionId,
                    timestamp: new Date(),
                    duration,
                    success: finalResult.success,
                    outputSize: finalResult.data ? JSON.stringify(finalResult.data).length : 0,
                    ...(Object.keys(contextData).length > 0 && { context: contextData })
                };

                await this.eventEmitter.emit('module.execution.complete', {
                    data: this.convertToEventData(eventData),
                    timestamp: new Date()
                });
            }

            return finalResult;

        } catch (error) {
            const duration = Date.now() - startTime;

            // Update error statistics
            this.stats.errorCount++;
            this.stats.lastActivity = new Date();

            const errorResult: ModuleExecutionResult = {
                success: false,
                error: error instanceof Error ? error : new Error(String(error)),
                duration
            };

            // Call error hook
            await this.onError?.(errorResult.error!, context);

            // Emit execution error event
            if (this.eventEmitter) {
                const contextData: Record<string, string> = {};
                if (context['sessionId']) contextData['sessionId'] = context['sessionId'];
                if (context['userId']) contextData['userId'] = context['userId'];
                if (context['agentName']) contextData['agentName'] = context['agentName'];

                const eventData: ModuleExecutionEventData = {
                    moduleName: this.name,
                    moduleType: this.getModuleType().type,
                    phase: 'error',
                    executionId,
                    timestamp: new Date(),
                    duration,
                    success: false,
                    error: errorResult.error!.message,
                    ...(Object.keys(contextData).length > 0 && { context: contextData })
                };

                await this.eventEmitter.emit('module.execution.error', {
                    data: this.convertToEventData(eventData),
                    error: errorResult.error!,
                    timestamp: new Date()
                });
            }

            throw errorResult.error;
        }
    }

    /**
     * Custom execution logic - must be implemented by modules that support execution
     */
    protected async onExecute(_context: ModuleExecutionContext): Promise<ModuleExecutionResult> {
        throw new Error(`Module ${this.name} does not implement execute functionality`);
    }

    /**
     * Dispose module resources
     */
    async dispose(): Promise<void> {
        this.logger.debug('Module disposing', { name: this.name });

        const startTime = Date.now();

        // Emit disposal event
        if (this.eventEmitter && this.initialized) {
            const eventData: ModuleDisposalEventData = {
                moduleName: this.name,
                moduleType: this.getModuleType().type,
                phase: 'start',
                timestamp: new Date()
            };

            await this.eventEmitter.emit('module.dispose.start', {
                data: this.convertToEventData(eventData),
                timestamp: new Date()
            });
        }

        try {
            // Call custom disposal logic
            await this.onDispose();

            this.initialized = false;
            this.enabled = false;

            const duration = Date.now() - startTime;

            // Emit successful disposal
            if (this.eventEmitter) {
                const eventData: ModuleDisposalEventData = {
                    moduleName: this.name,
                    moduleType: this.getModuleType().type,
                    phase: 'complete',
                    timestamp: new Date(),
                    duration,
                    resourcesReleased: ['memory', 'event-handlers', 'timers']
                };

                await this.eventEmitter.emit('module.dispose.complete', {
                    data: this.convertToEventData(eventData),
                    timestamp: new Date()
                });
            }

            this.logger.info('Module disposed successfully', { name: this.name });

        } catch (error) {
            const duration = Date.now() - startTime;

            // Emit disposal error
            if (this.eventEmitter) {
                const eventData: ModuleDisposalEventData = {
                    moduleName: this.name,
                    moduleType: this.getModuleType().type,
                    phase: 'error',
                    timestamp: new Date(),
                    duration,
                    error: error instanceof Error ? error.message : String(error)
                };

                await this.eventEmitter.emit('module.dispose.error', {
                    data: this.convertToEventData(eventData),
                    error: error instanceof Error ? error : new Error(String(error)),
                    timestamp: new Date()
                });
            }

            this.logger.error('Module disposal failed', {
                name: this.name,
                error: error instanceof Error ? error.message : String(error)
            });

            throw error;
        }
    }

    /**
     * Custom disposal logic - can be overridden by modules
     */
    protected async onDispose(): Promise<void> {
        // Default implementation - can be overridden
    }

    /**
     * Enable the module
     */
    enable(): void {
        this.enabled = true;
        this.logger.debug('Module enabled', { name: this.name });
    }

    /**
     * Disable the module
     */
    disable(): void {
        this.enabled = false;
        this.logger.debug('Module disabled', { name: this.name });
    }

    /**
     * Check if module is enabled
     */
    isEnabled(): boolean {
        return this.enabled;
    }

    /**
     * Check if module is initialized
     */
    isInitialized(): boolean {
        return this.initialized;
    }

    /**
     * Get module data for introspection
     */
    getData(): ModuleData {
        return {
            name: this.name,
            version: this.version,
            type: this.getModuleType().type,
            enabled: this.enabled,
            initialized: this.initialized,
            capabilities: this.getCapabilities(),
            metadata: {
                category: this.getModuleType().category,
                layer: this.getModuleType().layer
            }
        };
    }

    /**
     * Get module statistics
     */
    getStats(): TStats {
        const averageTime = this.stats.executionCount > 0
            ? this.stats.totalExecutionTime / this.stats.executionCount
            : undefined;

        const baseStats: ModuleStats = {
            enabled: this.enabled,
            initialized: this.initialized,
            executionCount: this.stats.executionCount,
            errorCount: this.stats.errorCount,
            ...(this.stats.lastActivity && { lastActivity: this.stats.lastActivity }),
            ...(averageTime !== undefined && { averageExecutionTime: averageTime })
        };

        return baseStats as TStats;
    }

    /**
     * Get module status
     */
    getStatus(): {
        name: string;
        version: string;
        type: string;
        enabled: boolean;
        initialized: boolean;
        hasEventEmitter: boolean;
    } {
        return {
            name: this.name,
            version: this.version,
            type: this.getModuleType().type,
            enabled: this.enabled,
            initialized: this.initialized,
            hasEventEmitter: !!this.eventEmitter
        };
    }

    /**
     * Convert module event data to EventExecutionContextData format
     */
    private convertToEventData(data: ModuleInitializationEventData | ModuleExecutionEventData | ModuleDisposalEventData): EventExecutionContextData {
        const result: EventExecutionContextData = {};

        // Convert all properties to EventExecutionContextData compatible format
        for (const [key, value] of Object.entries(data)) {
            if (value === undefined) continue;

            if (key === 'timestamp' && value instanceof Date) {
                result[key] = value.toISOString();
            } else if (key === 'metadata' && typeof value === 'object' && value !== null) {
                result[key] = value as Record<string, EventExecutionValue>;
            } else if (key === 'context' && typeof value === 'object' && value !== null) {
                result[key] = value as Record<string, EventExecutionValue>;
            } else if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
                result[key] = value;
            } else if (Array.isArray(value)) {
                result[key] = value as string[] | number[] | boolean[];
            } else if (typeof value === 'object' && value !== null) {
                result[key] = value as Record<string, EventExecutionValue>;
            }
        }

        return result;
    }

    // Optional lifecycle hooks - modules can override these
    async beforeExecution?(context: ModuleExecutionContext): Promise<void>;
    async afterExecution?(context: ModuleExecutionContext, result: ModuleExecutionResult): Promise<void>;
    async onActivate?(): Promise<void>;
    async onDeactivate?(): Promise<void>;
    async onError?(error: Error, context?: ModuleExecutionContext): Promise<void>;
}

/**
 * Standard module event data structures for consistent event communication
 */

/**
 * Base module event data interface
 */
export interface BaseModuleEventData {
    moduleName: string;
    moduleType: string;
    timestamp: Date;
    metadata?: Record<string, string | number | boolean | Date>;
}

/**
 * Module initialization event data
 */
export interface ModuleInitializationEventData extends BaseModuleEventData {
    phase: 'start' | 'complete' | 'error';
    duration?: number;
    error?: string;
    options?: Record<string, string | number | boolean>;
}

/**
 * Module execution event data
 */
export interface ModuleExecutionEventData extends BaseModuleEventData {
    phase: 'start' | 'complete' | 'error';
    executionId: string;
    duration?: number;
    success?: boolean;
    error?: string;
    inputSize?: number;
    outputSize?: number;
    context?: {
        sessionId?: string;
        userId?: string;
        agentName?: string;
    };
}

/**
 * Module disposal event data
 */
export interface ModuleDisposalEventData extends BaseModuleEventData {
    phase: 'start' | 'complete' | 'error';
    duration?: number;
    error?: string;
    resourcesReleased?: string[];
}

/**
 * Module capability event data (for capability registration/changes)
 */
export interface ModuleCapabilityEventData extends BaseModuleEventData {
    action: 'registered' | 'updated' | 'removed';
    capabilities: string[];
    dependencies?: string[];
}

/**
 * Module health event data (for monitoring and diagnostics)
 */
export interface ModuleHealthEventData extends BaseModuleEventData {
    status: 'healthy' | 'warning' | 'error' | 'critical';
    metrics: {
        memoryUsage?: number;
        cpuUsage?: number;
        executionCount?: number;
        errorCount?: number;
        averageResponseTime?: number;
    };
    issues?: Array<{
        severity: 'low' | 'medium' | 'high' | 'critical';
        message: string;
        code?: string;
    }>;
} 