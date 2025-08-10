/**
 * ContextualEventService Types and Interfaces
 * 
 * This module defines the types and interfaces for the new ContextualEventService
 * that will eventually replace ActionTrackingEventService as the standard EventService.
 */

import type { SimpleLogger } from '../../utils/simple-logger.js';
import type { ServiceEventType, ServiceEventData } from '../event-service.js';

/**
 * Context for creating a new EventService instance
 * Used by createChild method to pass context information
 */
export interface EventServiceCreationContext {
    // 🎯 Execution Context
    executionId?: string;
    parentExecutionId?: string;
    rootExecutionId?: string;
    executionLevel?: number;
    executionPath?: string[];

    // 🏷️ Source Information
    sourceType?: string;
    sourceId?: string;

    // 🔧 Tool Context
    toolName?: string;
    parameters?: Record<string, unknown>;

    // 📊 Configuration
    logger?: SimpleLogger;
    metadata?: Record<string, unknown>;
}

/**
 * Internal execution context used by ContextualEventService
 * This is more detailed than EventServiceCreationContext
 */
export interface InternalExecutionContext {
    executionId: string;
    parentExecutionId?: string;
    rootExecutionId?: string;
    executionLevel: number;
    executionPath: string[];
    sourceType: string;
    sourceId: string;
    toolName?: string;
    parameters?: Record<string, unknown>;
    metadata?: Record<string, unknown>;
    createdAt: Date;
}

/**
 * Enhanced EventService interface with contextual capabilities
 * This will become the new standard EventService interface
 */
export interface ContextualEventServiceInterface {
    // 🎯 Core EventService methods
    emit(eventType: ServiceEventType, data: ServiceEventData): void;
    trackExecution(executionId: string, parentExecutionId?: string, level?: number): void;
    createBoundEmit(executionId: string): (eventType: ServiceEventType, data: ServiceEventData) => void;

    // 🆕 Contextual capabilities - Method overloads
    createChild(childContext: EventServiceCreationContext): ContextualEventServiceInterface;
    createChild(sourceObject: unknown): ContextualEventServiceInterface; // 🎯 New `createChild(this)` pattern

    // 📊 Context access (optional, for debugging)
    getExecutionContext?(): InternalExecutionContext | undefined;
    getContextHierarchy?(): InternalExecutionContext[];
}

/**
 * Event data enhanced with automatic context injection
 */
export interface ContextualEventData {
    // Include all ServiceEventData fields
    eventType?: string;
    sourceType?: 'agent' | 'team' | 'tool';
    sourceId?: string;
    // Automatically injected by ContextualEventService
    executionId?: string;
    parentExecutionId?: string;
    rootExecutionId?: string;
    executionLevel?: number;
    executionPath?: string[];

    // Source information (already included above)

    // Tool context
    toolName?: string;

    // Timestamp (automatically injected by EventService)
    timestamp?: Date;
}

/**
 * Context extractor function that attempts to extract context from a source object
 * Returns null if the source doesn't match this extractor's pattern
 */
export type ContextExtractorFunction = (source: unknown) => EventServiceCreationContext | null;

/**
 * Context extractor entry with optional matching criteria
 */
export interface ContextExtractor {
    // Type matching (choose one)
    ctor?: new (...args: any[]) => unknown;   // instanceof matching
    name?: string;                            // constructor.name matching

    // Context extraction function
    extract: ContextExtractorFunction;
}

/**
 * Configuration for ContextualEventService
 */
export interface ContextualEventServiceConfig {
    baseEventService?: ContextualEventServiceInterface;
    logger?: SimpleLogger;
    executionContext?: EventServiceCreationContext | undefined;

    // 🎯 Function injection based context extraction
    contextExtractors?: ContextExtractor[];

    // 🔧 Advanced options
    autoInjectContext?: boolean; // Default: true
    preserveEventTimestamp?: boolean; // Default: true (don't override event timestamp)
    enableHierarchyTracking?: boolean; // Default: true
}
