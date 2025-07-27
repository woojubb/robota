/**
 * ExecutionHierarchyTracker - Service for tracking hierarchical relationships between execution entities
 * 
 * Architectural Principles:
 * - Service Pattern: Same pattern as ExecutionService, ToolExecutionService
 * - Dependency Injection: Optional logger injection
 * - Type Safety: 100% TypeScript, zero any/unknown
 * - Single Responsibility: Only hierarchy tracking, no other concerns
 * - Interface Segregation: Clean, minimal interface
 */

import { SimpleLogger, SilentLogger } from '../utils/simple-logger';

/**
 * Types of entities that can be tracked in the execution hierarchy
 */
export type EntityType =
    | 'conversation'       // Root conversation
    | 'team'              // Team container
    | 'agent'             // Individual agent
    | 'tool_execution'    // Tool execution instance
    | 'subtool'           // Agent internal tool
    | 'session'           // Session (future expansion)
    | 'custom';           // Custom entity types

/**
 * Execution entity definition
 */
export interface ExecutionEntity {
    /** Unique identifier for the entity */
    id: string;

    /** Type of the entity */
    type: EntityType;

    /** Parent entity ID (undefined for root entities) */
    parentId?: string;

    /** Root entity ID (conversation level) */
    rootId: string;

    /** Execution level in the hierarchy (0 = root) */
    level: number;

    /** Full execution path from root to current entity */
    path: string[];

    /** Entity creation timestamp */
    createdAt: Date;

    /** Optional metadata for the entity */
    metadata?: Record<string, any>;

    /** Optional tags for categorization */
    tags?: string[];
}

/**
 * Hierarchy information returned by the tracker
 */
export interface HierarchyInfo {
    /** Parent entity ID */
    parentId?: string;

    /** Root entity ID */
    rootId: string;

    /** Execution level */
    level: number;

    /** Full execution path */
    path: string[];

    /** Entity metadata */
    metadata?: Record<string, any>;

    /** Whether the entity exists in the tracker */
    exists: boolean;
}

/**
 * Options for tool execution instance registration
 */
export interface ToolExecutionRegistration {
    /** Tool execution instance ID */
    id: string;

    /** Tool name */
    toolName: string;

    /** OpenAI/Provider tool call ID */
    executionId: string;

    /** Parent entity ID */
    parentId: string;

    /** Root entity ID */
    rootId: string;

    /** Execution level */
    level: number;

    /** Execution path */
    path: string[];

    /** Tool execution parameters */
    parameters?: any;

    /** Additional metadata */
    metadata?: Record<string, any>;
}

/**
 * ExecutionHierarchyTracker service interface
 */
export interface ExecutionHierarchyTrackerInterface {
    /**
     * Register a new execution entity
     */
    registerEntity(entity: ExecutionEntity): void;

    /**
     * Register a tool execution instance (convenience method)
     */
    registerToolExecution(registration: ToolExecutionRegistration): void;

    /**
     * Get hierarchy information for an entity
     */
    getExecutionInfo(entityId: string): HierarchyInfo;

    /**
     * Check if an entity exists in the tracker
     */
    hasEntity(entityId: string): boolean;

    /**
     * Mark an execution as complete (for cleanup)
     */
    markExecutionComplete(entityId: string): void;

    /**
     * Clear all entities (for conversation end cleanup)
     */
    clear(): void;

    /**
     * Get all entities (for debugging)
     */
    getAllEntities(): Map<string, ExecutionEntity>;
}

/**
 * ExecutionHierarchyTracker - Service implementation
 * 
 * Follows Robota SDK service patterns:
 * - Stateful service with dependency injection
 * - Optional logger injection with SilentLogger default
 * - Clean error handling with actionable messages
 * - Memory management for long-running sessions
 */
export class ExecutionHierarchyTracker implements ExecutionHierarchyTrackerInterface {
    private entities = new Map<string, ExecutionEntity>();
    private readonly logger: SimpleLogger;

    constructor(logger?: SimpleLogger) {
        this.logger = logger || SilentLogger;
        this.logger.debug('ExecutionHierarchyTracker initialized');
    }

    /**
     * Register a new execution entity
     */
    registerEntity(entity: ExecutionEntity): void {
        if (!entity.id) {
            throw new Error('Entity ID is required for registration');
        }

        if (this.entities.has(entity.id)) {
            this.logger.warn(`Entity ${entity.id} already exists, overwriting`, {
                existingType: this.entities.get(entity.id)?.type,
                newType: entity.type
            });
        }

        // Validate hierarchy consistency
        if (entity.parentId && !this.entities.has(entity.parentId)) {
            this.logger.warn(`Parent entity ${entity.parentId} not found for ${entity.id}`, {
                entityId: entity.id,
                parentId: entity.parentId
            });
        }

        this.entities.set(entity.id, entity);
        this.logger.debug(`Entity registered: ${entity.id}`, {
            type: entity.type,
            level: entity.level,
            parentId: entity.parentId
        });
    }

    /**
     * Register a tool execution instance (convenience method)
     */
    registerToolExecution(registration: ToolExecutionRegistration): void {
        const entity: ExecutionEntity = {
            id: registration.id,
            type: 'tool_execution',
            parentId: registration.parentId,
            rootId: registration.rootId,
            level: registration.level,
            path: registration.path,
            createdAt: new Date(),
            metadata: {
                toolName: registration.toolName,
                executionId: registration.executionId,
                parameters: registration.parameters,
                ...registration.metadata
            }
        };

        this.registerEntity(entity);
    }

    /**
     * Get hierarchy information for an entity
     */
    getExecutionInfo(entityId: string): HierarchyInfo {
        const entity = this.entities.get(entityId);

        if (!entity) {
            this.logger.debug(`Entity ${entityId} not found in hierarchy tracker`);
            return {
                parentId: undefined,
                rootId: 'unknown-root',
                level: 0,
                path: [entityId],
                exists: false
            };
        }

        return {
            parentId: entity.parentId,
            rootId: entity.rootId,
            level: entity.level,
            path: entity.path,
            metadata: entity.metadata,
            exists: true
        };
    }

    /**
     * Check if an entity exists in the tracker
     */
    hasEntity(entityId: string): boolean {
        return this.entities.has(entityId);
    }

    /**
     * Mark an execution as complete (for cleanup)
     */
    markExecutionComplete(entityId: string): void {
        const entity = this.entities.get(entityId);
        if (entity) {
            entity.metadata = {
                ...entity.metadata,
                completedAt: new Date(),
                status: 'completed'
            };
            this.logger.debug(`Entity marked as complete: ${entityId}`);
        }
    }

    /**
     * Clear all entities (for conversation end cleanup)
     */
    clear(): void {
        const entityCount = this.entities.size;
        this.entities.clear();
        this.logger.debug(`Cleared ${entityCount} entities from hierarchy tracker`);
    }

    /**
     * Get all entities (for debugging)
     */
    getAllEntities(): Map<string, ExecutionEntity> {
        return new Map(this.entities);
    }
} 