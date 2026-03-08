/**
 * Type definitions, interfaces, and enums for the module system.
 *
 * Extracted from abstract-module.ts to keep each file under 300 lines.
 */
import type { IEventEmitterPlugin } from '../plugins/event-emitter/types';

/** Module execution context */
export interface IModuleExecutionContext {
    executionId?: string;
    sessionId?: string;
    userId?: string;
    agentName?: string;
    metadata?: Record<string, string | number | boolean | Date>;
    [key: string]: string | number | boolean | Date | Record<string, string | number | boolean | Date> | undefined;
}

/** Module execution result */
export interface IModuleExecutionResult {
    success: boolean;
    data?: IModuleResultData;
    error?: Error;
    duration?: number;
    metadata?: Record<string, string | number | boolean | Date>;
}

/** Module result data */
export interface IModuleResultData {
    [key: string]: string | number | boolean | Record<string, string | number | boolean> | undefined;
}

/** Base module options */
export interface IBaseModuleOptions {
    enabled?: boolean;
    config?: Record<string, string | number | boolean>;
}

/** Module capabilities */
export interface IModuleCapabilities {
    capabilities: string[];
    dependencies?: string[];
    optionalDependencies?: string[];
}

/** Module type descriptor */
export interface IModuleDescriptor {
    type: string;
    category: ModuleCategory;
    layer: ModuleLayer;
    dependencies?: string[];
    capabilities?: string[];
}

/** Module categories */
export enum ModuleCategory {
    CORE = 'core',
    STORAGE = 'storage',
    PROCESSING = 'processing',
    INTEGRATION = 'integration',
    INTERFACE = 'interface',
    CAPABILITY = 'capability'
}

/** Module layers */
export enum ModuleLayer {
    INFRASTRUCTURE = 'infrastructure',
    CORE = 'core',
    APPLICATION = 'application',
    DOMAIN = 'domain',
    PRESENTATION = 'presentation'
}

/** Module data for introspection */
export interface IModuleData {
    name: string;
    version: string;
    type: string;
    enabled: boolean;
    initialized: boolean;
    capabilities: IModuleCapabilities;
    metadata?: Record<string, string | number | boolean>;
}

/** Module statistics */
export interface IModuleStats {
    enabled: boolean;
    initialized: boolean;
    executionCount: number;
    errorCount: number;
    lastActivity?: Date;
    averageExecutionTime?: number;
    [key: string]: string | number | boolean | Date | undefined;
}

/** Type-safe module interface */
export interface IModule<TOptions extends IBaseModuleOptions = IBaseModuleOptions, TStats = IModuleStats> {
    name: string;
    version: string;
    enabled: boolean;
    initialize(options?: TOptions, eventEmitter?: IEventEmitterPlugin): Promise<void>;
    dispose?(): Promise<void>;
    execute?(context: IModuleExecutionContext): Promise<IModuleExecutionResult>;
    getModuleType(): IModuleDescriptor;
    getCapabilities(): IModuleCapabilities;
    getData?(): IModuleData;
    getStats?(): TStats;
    isEnabled(): boolean;
    isInitialized(): boolean;
}

/** Base module interface */
export interface IBaseModule extends IModule<IBaseModuleOptions, IModuleStats> { }

/** Module lifecycle hooks */
export interface IModuleHooks {
    beforeExecution?(context: IModuleExecutionContext): Promise<void> | void;
    afterExecution?(context: IModuleExecutionContext, result: IModuleExecutionResult): Promise<void> | void;
    onActivate?(): Promise<void> | void;
    onDeactivate?(): Promise<void> | void;
    onError?(error: Error, context?: IModuleExecutionContext): Promise<void> | void;
}
