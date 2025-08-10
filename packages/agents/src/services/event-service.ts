/**
 * EventService - Unified event emission system for Team/Agent/Tool integration
 * 
 * Architectural Principles:
 * - Built-in Service: Same pattern as ExecutionService
 * - Dependency Injection: Optional injection for flexibility
 * - Single Event Handler: emit(eventType, data) method only
 * - Architecture Consistency: 100% aligned with Robota SDK patterns
 */

import { SimpleLogger, DefaultConsoleLogger } from '../utils/simple-logger';
import type { ToolParameters, ToolResult, ToolExecutionContext } from '../interfaces/tool';
import type { LoggerData, MetadataValue } from '../interfaces/types';

// Step 1: ❌ Can't assign MetadataValue to string directly (type mismatch)
// Step 2: ✅ MetadataValue includes primitives but needs safe conversion
// Step 3: ✅ Create type guards for safe metadata value extraction
// Step 4: ✅ Provide fallback values for type safety
function safeStringFromMetadata(value: MetadataValue | undefined): string | undefined {
    if (typeof value === 'string') return value;
    if (typeof value === 'number') return String(value);
    if (typeof value === 'boolean') return String(value);
    if (value instanceof Date) return value.toISOString();
    if (value instanceof Error) return value.message;
    return undefined;
}

function hasMetadataProperty(obj: any, prop: string): boolean {
    return obj && typeof obj === 'object' && prop in obj;
}

/**
 * Service event types for unified tracking
 * 
 * IMPORTANT: EventService is domain-neutral infrastructure.
 * It does NOT know about specific events from other packages.
 * Event names follow the pattern: '{owner}.{event}' where owner
 * is the package/component that emits the event.
 */
export type ServiceEventType = string;

/**
 * Service event data structure with hierarchical tracking information
 */
export interface ServiceEventData {
    /** Source type: agent, team, or tool (sub-agent removed for domain neutrality) */
    sourceType: 'agent' | 'team' | 'tool';

    /** Source identifier (agent ID, team ID, etc.) */
    sourceId: string;

    /** Event timestamp (auto-generated if not provided) */
    timestamp?: Date;

    // Hierarchical tracking information (extracted from ToolExecutionContext)
    /** Parent execution ID for hierarchical tracking */
    parentExecutionId?: string;

    /** Root execution ID (Team/Agent level) */
    rootExecutionId?: string;

    /** Execution depth level (0: Team, 1: Agent, 2: Tool) */
    executionLevel?: number;

    /** Execution path array for complete hierarchy */
    executionPath?: string[];

    // Event-specific data
    /** Tool name for tool-related events */
    toolName?: string;

    /** Parameters passed to tool/agent */
    parameters?: ToolParameters;

    /** Result from tool/agent execution */
    result?: ToolResult;

    /** Error message for error events */
    error?: string;

    /** Task description for task events */
    taskDescription?: string;

    /** Additional metadata */
    metadata?: LoggerData;

    // Agent Integration Instance specific data (for Playground-level connection quality)
    /** Integration instance identifier for result consolidation */
    integrationId?: string;

    /** Source response IDs being integrated */
    sourceResponseIds?: string[];

    /** Integration processing level (3: Integration Instance level) */
    integrationLevel?: number;

    /** Allow additional properties for extensibility */
    // eslint-disable-next-line @typescript-eslint/ban-types -- tried-alternatives, generic-constraint
    [key: string]: unknown;
}

/**
 * Execution node for hierarchy tracking
 * Represents a single execution instance in the execution tree
 */
export interface ExecutionNode {
    /** Unique execution ID */
    id: string;

    /** Parent execution ID (undefined for root) */
    parentId?: string;

    /** Execution level (0=Team, 1=Agent, 2=Tool) */
    level: number;

    /** Child execution IDs */
    children: string[];

    /** Execution metadata */
    metadata?: {
        toolName?: string;
        startTime?: Date;
        source?: string;
        // eslint-disable-next-line @typescript-eslint/ban-types -- tried-alternatives, generic-constraint
        [key: string]: unknown;
    };
}

/**
 * EventService interface - Single event emission point
 * 
 * Enhanced with optional methods for hierarchical tracking.
 * These methods are detected via Duck Typing pattern for zero-configuration.
 */
export interface EventService {
    /**
     * Emit an event with data
     * @param eventType - Type of event to emit
     * @param data - Event data with hierarchical information
     */
    emit(eventType: ServiceEventType, data: ServiceEventData): void;

    /**
     * Optional: Track execution hierarchy (Duck Typing detection)
     * Enables automatic hierarchical context for all events
     * 
     * @param executionId - Unique execution ID
     * @param parentExecutionId - Parent execution ID
     * @param level - Execution level (0=Team, 1=Agent, 2=Tool)
     */
    trackExecution?(executionId: string, parentExecutionId?: string, level?: number): void;

    /**
     * Optional: Create bound emit function with automatic context (Duck Typing detection)
     * Returns an emit function that automatically includes hierarchical context
     * 
     * @param executionId - Execution ID to bind context to
     * @returns Bound emit function with automatic parent/level context
     */
    createBoundEmit?(executionId: string): (eventType: ServiceEventType, data: ServiceEventData) => void;

    /**
     * Optional: Create new EventService instance with injected context (Duck Typing detection)
     * Returns a new EventService that inherits from this one but has additional context
     * 
     * @param executionContext - Context to inject into the new instance
     * @returns New EventService instance with context binding
     */
    createContextBoundInstance?(executionContext: ToolExecutionContext): EventService;
}

/**
 * Silent event service - No-op implementation (default)
 * Used when no specific event handling is needed
 */
export class SilentEventService implements EventService {
    emit(eventType: ServiceEventType, data: ServiceEventData): void {
        // No-op: Silent operation for performance
    }
}

/**
 * Default console event service - Basic logging implementation
 * Useful for development and debugging
 */
export class DefaultEventService implements EventService {
    private readonly logger: SimpleLogger;

    constructor(logger?: SimpleLogger) {
        this.logger = logger || DefaultConsoleLogger;
    }

    emit(eventType: ServiceEventType, data: ServiceEventData): void {
        const timestamp = data.timestamp || new Date();
        const logData = {
            eventType,
            sourceType: data.sourceType,
            sourceId: data.sourceId,
            timestamp: timestamp.toISOString(),
            executionLevel: data.executionLevel,
            executionPath: data.executionPath?.join('→'),
            ...(data.toolName && { toolName: data.toolName }),
            ...(data.taskDescription && { taskDescription: data.taskDescription }),
            ...(data.error && { error: data.error })
        };

        this.logger.info(`🔔 [${eventType}]`, logData);
    }
}

/**
 * Structured event service - Enhanced logging with metadata
 * Provides detailed structured logging for analysis
 */
export class StructuredEventService implements EventService {
    private readonly logger: SimpleLogger;

    constructor(logger?: SimpleLogger) {
        this.logger = logger || DefaultConsoleLogger;
    }

    emit(eventType: ServiceEventType, data: ServiceEventData): void {
        const timestamp = data.timestamp || new Date();
        const eventId = this.generateEventId();

        const structuredEvent = {
            id: eventId,
            type: eventType,
            timestamp: timestamp.toISOString(),
            source: {
                type: data.sourceType,
                id: data.sourceId
            },
            hierarchy: {
                level: data.executionLevel || 0,
                path: data.executionPath || [],
                parentId: data.parentExecutionId,
                rootId: data.rootExecutionId
            },
            payload: {
                ...(data.toolName && { toolName: data.toolName }),
                ...(data.parameters && { parameters: data.parameters }),
                ...(data.result && { result: data.result }),
                ...(data.error && { error: data.error }),
                ...(data.taskDescription && { taskDescription: data.taskDescription }),
                ...(data.metadata && { metadata: data.metadata })
            }
        };

        this.logger.info(`📊 [STRUCTURED_EVENT]`, structuredEvent);
    }

    private generateEventId(): string {
        return `evt_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }
}

/**
 * ActionTrackingEventService - Enhanced EventService with automatic hierarchy tracking
 * 
 * Wraps any base EventService and adds automatic hierarchical context to all events.
 * Uses Duck Typing pattern for zero-configuration integration with existing code.
 * 
 * Key Features:
 * - Automatic parent-child relationship tracking
 * - Execution level inference (Team=0, Agent=1, Tool=2)
 * - Bound emit functions with pre-filled context
 * - Full backward compatibility with base EventService
 * 
 * @example
 * ```typescript
 * const enhanced = new ActionTrackingEventService(new PlaygroundEventService());
 * 
 * // Track execution hierarchy
 * enhanced.trackExecution('agent-001', 'team-main', 1);
 * 
 * // Create bound emit with automatic context
 * const boundEmit = enhanced.createBoundEmit('agent-001');
 * boundEmit('execution.start', { sourceType: 'agent', sourceId: 'agent-001' });
 * // Automatically includes: parentExecutionId: 'team-main', executionLevel: 1
 * ```
 */
export class ActionTrackingEventService implements EventService {
    private readonly baseEventService: EventService;
    private readonly executionHierarchy: Map<string, ExecutionNode> = new Map();
    private readonly logger: SimpleLogger;
    private readonly executionContext?: ToolExecutionContext; // 🎯 [CONTEXT-INJECTION] Store execution context for hierarchy tracking

    constructor(baseEventService?: EventService, logger?: SimpleLogger, executionContext?: ToolExecutionContext) {
        this.baseEventService = baseEventService || new SilentEventService();
        this.logger = logger || DefaultConsoleLogger;
        this.executionContext = executionContext; // 🎯 [CONTEXT-INJECTION] Store context for hierarchy enrichment
    }

    /**
     * Standard emit method - forwards to base service with enriched hierarchy data
     */
    emit(eventType: ServiceEventType, data: ServiceEventData): void {
        // 🎯 [DOMAIN-NEUTRAL] EventService는 도메인 독립적 - 단순히 hierarchy context 전달만 수행
        const enrichedData = this.enrichWithHierarchy(data);
        this.baseEventService.emit(eventType, enrichedData);
    }

    /**
     * Track execution in the hierarchy
     * Registers a new execution node with parent-child relationships
     */
    trackExecution(executionId: string, parentExecutionId?: string, level?: number): void {
        // Infer level from parent if not provided
        const inferredLevel = level ?? this.inferLevelFromParent(parentExecutionId);

        // Add child reference to parent
        if (parentExecutionId && this.executionHierarchy.has(parentExecutionId)) {
            const parent = this.executionHierarchy.get(parentExecutionId)!;
            if (!parent.children.includes(executionId)) {
                parent.children.push(executionId);
            }
        }

        // Register execution node
        this.executionHierarchy.set(executionId, {
            id: executionId,
            parentId: parentExecutionId,
            level: inferredLevel,
            children: [],
            metadata: {
                startTime: new Date(),
                source: 'ActionTrackingEventService'
            }
        });
    }

    /**
     * Create bound emit function with automatic hierarchical context
     * Returns a function that automatically includes parent/level information
     */
    createBoundEmit(executionId: string): (eventType: ServiceEventType, data: ServiceEventData) => void {
        return (eventType: ServiceEventType, data: ServiceEventData) => {
            const node = this.executionHierarchy.get(executionId);

            const enrichedData: ServiceEventData = {
                ...data,
                parentExecutionId: node?.parentId,
                rootExecutionId: this.findRootId(executionId),
                executionLevel: node?.level,
                executionPath: this.buildExecutionPath(executionId)
            };

            this.emit(eventType, enrichedData);
        };
    }

    /**
     * 🎯 [CONTEXT-BINDING] Create new EventService instance with injected context
     * This enables automatic context propagation through the event system
     * 
     * @param executionContext - Context to inject into the new instance
     * @returns New EventService instance with context binding
     */
    createContextBoundInstance(executionContext: ToolExecutionContext): EventService {
        this.logger.debug('🎯 [CONTEXT-BINDING] Creating context-bound EventService instance', {
            executionId: executionContext.executionId,
            parentExecutionId: executionContext.parentExecutionId,
            executionLevel: executionContext.executionLevel
        });

        // Create new ActionTrackingEventService instance that inherits from this one
        // but has the provided context injected
        return new ActionTrackingEventService(
            this.baseEventService, // 🎯 같은 baseEventService 계승하여 일관된 통로 유지
            this.logger,
            executionContext // 🎯 새 인스턴스에 context 주입
        );
    }

    /**
     * Enrich event data with hierarchical context information and injected execution context
     */
    private enrichWithHierarchy(data: ServiceEventData): ServiceEventData {
        const executionId = this.findExecutionId(data);

        this.logger.debug('🔍 [ActionTrackingEventService] enrichWithHierarchy called', {
            executionId,
            hasExecutionId: !!executionId,
            hierarchySize: this.executionHierarchy.size,
            dataKeys: Object.keys(data),
            hasInjectedContext: !!this.executionContext
        });

        // 🎯 [CONTEXT-AUTOMATION] 주입된 execution context를 자동으로 payload에 추가
        let enrichedData = { ...data };

        if (this.executionContext) {
            enrichedData = {
                ...enrichedData,
                // 기존 값이 없을 때만 injected context 값 사용
                executionLevel: enrichedData.executionLevel ?? this.executionContext.executionLevel,
                parentExecutionId: enrichedData.parentExecutionId ?? this.executionContext.parentExecutionId,
                rootExecutionId: enrichedData.rootExecutionId ?? this.executionContext.rootExecutionId,
                executionPath: enrichedData.executionPath ?? this.executionContext.executionPath,
            };

            this.logger.debug('🎯 [CONTEXT-AUTOMATION] Injected context applied to event', {
                injectedLevel: this.executionContext.executionLevel,
                injectedParent: this.executionContext.parentExecutionId,
                injectedRoot: this.executionContext.rootExecutionId
            });
        }

        if (!executionId) {
            this.logger.debug('⚠️ [ActionTrackingEventService] No executionId found, returning context-enriched data');
            return enrichedData;
        }

        const node = this.executionHierarchy.get(executionId);
        this.logger.debug('🔍 [ActionTrackingEventService] Hierarchy node lookup', {
            executionId,
            nodeFound: !!node,
            node: node ? {
                level: node.level,
                parentId: node.parentId,
                id: node.id
            } : null
        });

        if (!node) {
            this.logger.debug('⚠️ [ActionTrackingEventService] No hierarchy node found for executionId:', executionId);
            return enrichedData;
        }

        // 🎯 [HIERARCHY-AUTOMATION] hierarchy 정보로 추가 보강 (기존 값 우선)
        enrichedData = {
            ...enrichedData,
            executionLevel: enrichedData.executionLevel ?? node.level,
            parentExecutionId: enrichedData.parentExecutionId ?? node.parentId,
            rootExecutionId: enrichedData.rootExecutionId ?? this.findRootId(executionId),
            executionPath: enrichedData.executionPath ?? this.buildExecutionPath(executionId),
            // 🎯 중요: metadata 보존 (tool_call의 directParentId 등)
            ...(data.metadata && { metadata: data.metadata })
        };

        this.logger.debug('✅ [ActionTrackingEventService] Data enriched successfully', {
            originalLevel: data.executionLevel,
            enrichedLevel: enrichedData.executionLevel,
            originalParent: data.parentExecutionId,
            enrichedParent: enrichedData.parentExecutionId,
            contextSource: this.executionContext ? 'injected+hierarchy' : 'hierarchy-only'
        });

        return enrichedData;
    }

    /**
     * Infer execution level from parent node
     */
    private inferLevelFromParent(parentExecutionId?: string): number {
        if (!parentExecutionId) {
            return 0; // Root level (Team)
        }

        const parent = this.executionHierarchy.get(parentExecutionId);
        if (!parent) {
            return 1; // Default to Agent level
        }

        return parent.level + 1;
    }

    /**
     * Find root execution ID by traversing up the hierarchy
     */
    private findRootId(executionId: string): string {
        const node = this.executionHierarchy.get(executionId);
        if (!node || !node.parentId) {
            return executionId; // This is the root
        }

        return this.findRootId(node.parentId);
    }

    /**
     * Build execution path array from root to current execution
     */
    private buildExecutionPath(executionId: string): string[] {
        const path: string[] = [];
        let currentId: string | undefined = executionId;

        while (currentId) {
            path.unshift(currentId);
            const node = this.executionHierarchy.get(currentId);
            currentId = node?.parentId;
        }

        return path;
    }

    /**
     * Find appropriate execution ID from event data with multiple fallback strategies
     */
    private findExecutionId(data: ServiceEventData): string | undefined {
        this.logger.debug('🔍 [ActionTrackingEventService] findExecutionId searching in:', {
            executionId: data.executionId,
            sourceId: data.sourceId,
            sourceType: data.sourceType,
            agentId: (data as any).agentId,
            toolName: data.toolName,
            eventType: data.eventType || 'unknown',
            metadata: data.metadata ? {
                executionId: data.metadata.executionId,
                parentExecutionId: data.metadata.parentExecutionId,
                agentId: data.metadata.agentId,
                toolCallId: data.metadata.toolCallId
            } : undefined,
            context: data.context ? {
                executionId: (data.context as any).executionId,
                metadata: (data.context as any).metadata
            } : undefined,
            hierarchySize: this.executionHierarchy.size,
            allRegisteredIds: Array.from(this.executionHierarchy.keys())
        });

        // Strategy 1: Direct executionId field
        const directExecutionId = safeStringFromMetadata(data.executionId as MetadataValue);
        if (directExecutionId) {
            this.logger.debug('✅ [ActionTrackingEventService] Found direct executionId:', { executionId: directExecutionId });
            return directExecutionId;
        }

        // Strategy 2: metadata.executionId
        const metadataExecutionId = hasMetadataProperty(data.metadata, 'executionId')
            ? safeStringFromMetadata((data.metadata as any).executionId)
            : undefined;
        if (metadataExecutionId) {
            this.logger.debug('✅ [ActionTrackingEventService] Found metadata.executionId:', { executionId: metadataExecutionId });
            return metadataExecutionId;
        }

        // Strategy 3: metadata.toolCallId (for tool events)
        const toolCallId = hasMetadataProperty(data.metadata, 'toolCallId')
            ? safeStringFromMetadata((data.metadata as any).toolCallId)
            : undefined;
        if (toolCallId) {
            this.logger.debug('✅ [ActionTrackingEventService] Found metadata.toolCallId:', { toolCallId });
            return toolCallId;
        }

        // Strategy 4: context.metadata.parentExecutionId (for nested contexts)
        const contextParentId = hasMetadataProperty(data.context, 'metadata') && hasMetadataProperty((data.context as any).metadata, 'parentExecutionId')
            ? safeStringFromMetadata((data.context as any).metadata.parentExecutionId)
            : undefined;
        if (contextParentId) {
            this.logger.debug('✅ [ActionTrackingEventService] Found context.metadata.parentExecutionId:', { parentExecutionId: contextParentId });
            return contextParentId;
        }

        // Strategy 4b: metadata.context.metadata.parentExecutionId (EventServiceHookFactory format)
        const metadataContextParentId = hasMetadataProperty(data.metadata, 'context') &&
            hasMetadataProperty((data.metadata as any).context, 'metadata') &&
            hasMetadataProperty((data.metadata as any).context.metadata, 'parentExecutionId')
            ? safeStringFromMetadata((data.metadata as any).context.metadata.parentExecutionId)
            : undefined;
        if (metadataContextParentId) {
            this.logger.debug('✅ [ActionTrackingEventService] Found metadata.context.metadata.parentExecutionId:', { parentExecutionId: metadataContextParentId });
            return metadataContextParentId;
        }

        // Strategy 5: Search hierarchy by toolName or sourceId pattern
        if (data.toolName || data.sourceId) {
            const searchKey = data.toolName || data.sourceId;
            this.logger.debug('🔍 [ActionTrackingEventService] Searching hierarchy by pattern:', {
                searchKey,
                totalHierarchyEntries: this.executionHierarchy.size
            });

            for (const [executionId, node] of this.executionHierarchy.entries()) {
                const matches = {
                    toolNameMatch: node.metadata?.toolName === searchKey,
                    idIncludesKey: executionId.includes(searchKey),
                    sourceIdMatch: node.metadata?.sourceId === data.sourceId
                };

                this.logger.debug('🔍 [ActionTrackingEventService] Checking node:', {
                    executionId,
                    nodeLevel: node.level,
                    nodeParent: node.parentId,
                    nodeMetadata: node.metadata,
                    matches
                });

                if (matches.toolNameMatch || matches.idIncludesKey || matches.sourceIdMatch) {
                    this.logger.debug('✅ [ActionTrackingEventService] Found by pattern search:', {
                        executionId,
                        matchType: matches.toolNameMatch ? 'toolName' : matches.idIncludesKey ? 'idIncludes' : 'sourceId',
                        nodeDetails: node
                    });
                    return executionId;
                }
            }
            this.logger.debug('⚠️ [ActionTrackingEventService] No pattern match found for:', {
                searchKey,
                checkedEntries: this.executionHierarchy.size
            });
        }

        // Strategy 6: Create mapping for agent/exec IDs to track cross-layer relationships
        if (data.sourceId) {
            // Store source ID mappings for future correlation
            this.storeSourceMapping(data.sourceId, data);
            this.logger.debug('⚠️ [ActionTrackingEventService] Using fallback ID and storing mapping:', data.sourceId);
            return data.sourceId;
        }

        this.logger.debug('❌ [ActionTrackingEventService] No executionId found in data');
        return undefined;
    }

    /**
     * Store source ID mappings for cross-layer correlation
     */
    private storeSourceMapping(sourceId: string, data: ServiceEventData): void {
        // Create a mapping entry for correlation
        const mappingKey = `mapping-${sourceId}`;
        if (!this.executionHierarchy.has(mappingKey)) {
            // Infer level based on sourceType and eventType
            let inferredLevel = 0;
            let inferredParent: string | undefined = undefined;

            if (data.sourceType === 'tool') {
                inferredLevel = 1; // Tools are typically Level 1
                // Try to find parent from context or metadata (multiple formats)
                const contextMetadataParentId = hasMetadataProperty(data.context, 'metadata') && hasMetadataProperty((data.context as any).metadata, 'parentExecutionId')
                    ? safeStringFromMetadata((data.context as any).metadata.parentExecutionId)
                    : undefined;
                const directMetadataParentId = hasMetadataProperty(data.metadata, 'parentExecutionId')
                    ? safeStringFromMetadata((data.metadata as any).parentExecutionId)
                    : undefined;
                const nestedMetadataParentId = hasMetadataProperty(data.metadata, 'context') &&
                    hasMetadataProperty((data.metadata as any).context, 'metadata') &&
                    hasMetadataProperty((data.metadata as any).context.metadata, 'parentExecutionId')
                    ? safeStringFromMetadata((data.metadata as any).context.metadata.parentExecutionId)
                    : undefined;

                if (contextMetadataParentId) {
                    inferredParent = contextMetadataParentId;
                    inferredLevel = 2; // If has parent, likely Level 2
                } else if (directMetadataParentId) {
                    inferredParent = directMetadataParentId;
                    inferredLevel = 2;
                } else if (nestedMetadataParentId) {
                    // EventServiceHookFactory format
                    inferredParent = nestedMetadataParentId;
                    inferredLevel = 2;
                }
            } else if (data.sourceType === 'team') {
                inferredLevel = 2; // Team events are typically Level 2
                // Try to find parent tool or agent execution - check data.parentExecutionId first
                if (data.parentExecutionId) {
                    // Check if the parentExecutionId already exists in hierarchy
                    if (this.executionHierarchy.has(data.parentExecutionId)) {
                        inferredParent = data.parentExecutionId;
                        this.logger.debug(`✅ [ActionTrackingEventService] Team event parent found in hierarchy: ${data.parentExecutionId}`);
                    } else {
                        this.logger.debug(`⚠️ [ActionTrackingEventService] Team event parent NOT found in hierarchy: ${data.parentExecutionId}`);
                    }
                } else {
                    const teamMetadataParentId = hasMetadataProperty(data.metadata, 'parentExecutionId')
                        ? safeStringFromMetadata((data.metadata as any).parentExecutionId)
                        : undefined;
                    if (teamMetadataParentId && this.executionHierarchy.has(teamMetadataParentId)) {
                        inferredParent = teamMetadataParentId;
                    } else {
                        // Check nested metadata context format
                        const hierarchyParentId = hasMetadataProperty(data.metadata, 'context') &&
                            hasMetadataProperty((data.metadata as any).context, 'metadata') &&
                            hasMetadataProperty((data.metadata as any).context.metadata, 'parentExecutionId')
                            ? safeStringFromMetadata((data.metadata as any).context.metadata.parentExecutionId)
                            : undefined;
                        if (hierarchyParentId && this.executionHierarchy.has(hierarchyParentId)) {
                            inferredParent = hierarchyParentId;
                        }
                    }
                }
            } else if (data.sourceType === 'agent') {
                inferredLevel = 1; // Agent events are typically Level 1
                const agentMetadataParentId = hasMetadataProperty(data.metadata, 'parentExecutionId')
                    ? safeStringFromMetadata((data.metadata as any).parentExecutionId)
                    : undefined;
                const agentNestedParentId = hasMetadataProperty(data.metadata, 'context') &&
                    hasMetadataProperty((data.metadata as any).context, 'metadata') &&
                    hasMetadataProperty((data.metadata as any).context.metadata, 'parentExecutionId')
                    ? safeStringFromMetadata((data.metadata as any).context.metadata.parentExecutionId)
                    : undefined;

                if (agentMetadataParentId) {
                    inferredParent = agentMetadataParentId;
                } else if (agentNestedParentId) {
                    inferredParent = agentNestedParentId;
                }
            }

            this.logger.debug('📝 [ActionTrackingEventService] Creating source mapping:', {
                mappingKey,
                sourceId,
                sourceType: data.sourceType,
                inferredLevel,
                inferredParent,
                contextParent: hasMetadataProperty(data.context, 'metadata') && hasMetadataProperty((data.context as any).metadata, 'parentExecutionId')
                    ? safeStringFromMetadata((data.context as any).metadata.parentExecutionId) : undefined,
                metadataParent: hasMetadataProperty(data.metadata, 'parentExecutionId')
                    ? safeStringFromMetadata((data.metadata as any).parentExecutionId) : undefined,
                metadataContextParent: hasMetadataProperty(data.metadata, 'context') &&
                    hasMetadataProperty((data.metadata as any).context, 'metadata') &&
                    hasMetadataProperty((data.metadata as any).context.metadata, 'parentExecutionId')
                    ? safeStringFromMetadata((data.metadata as any).context.metadata.parentExecutionId) : undefined,
                fullMetadata: data.metadata
            });

            this.executionHierarchy.set(mappingKey, {
                id: mappingKey,
                parentId: inferredParent,
                level: inferredLevel,
                children: [],
                metadata: {
                    sourceId,
                    mappingType: 'source-correlation',
                    inferredLevel,
                    inferredParent,
                    originalData: {
                        sourceType: data.sourceType,
                        timestamp: data.timestamp,
                        eventType: data.eventType || 'unknown'
                    }
                }
            });
        }
    }

    /**
     * Get current hierarchy state (for debugging)
     */
    getHierarchy(): Map<string, ExecutionNode> {
        return new Map(this.executionHierarchy);
    }

    /**
     * Clear hierarchy state
     */
    clearHierarchy(): void {
        this.executionHierarchy.clear();
    }
} 