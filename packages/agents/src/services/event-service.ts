/**
 * EventService - Unified event emission system (ownerPath-only)
 *
 * Architectural Principles:
 * - Dependency Injection: inject a base EventService, then bind an owner with `bindWithOwnerPath`.
 * - Path-only: hierarchy/relationships are expressed only via `EventContext.ownerPath` (absolute).
 * - No-fallback: missing required path/context is a design error and must fail fast.
 */

import { SimpleLogger, DefaultConsoleLogger } from '../utils/simple-logger';
import type { ToolExecutionContext } from '../interfaces/tool';
import type { TLoggerData } from '../interfaces/types';
import type {
    AgentEventData,
    BaseEventData,
    EventContext,
    EventService,
    EventServiceOwnerBinding,
    ExecutionEventData,
    OwnerPathSegment,
    OwnerType,
    ServiceEventData,
    ServiceEventType,
    ToolEventData
} from '../interfaces/event-service';
export type {
    AgentEventData,
    BaseEventData,
    EventContext,
    EventService,
    EventServiceOwnerBinding,
    ExecutionEventData,
    OwnerPathSegment,
    OwnerType,
    ServiceEventData,
    ServiceEventType,
    ToolEventData
} from '../interfaces/event-service';

// NOTE: Legacy hierarchy helpers removed. Use `context.ownerPath` (absolute) for all relationships.


/**
 * AbstractEventService - base class providing no-op defaults.
 * This is the single no-op implementation baseline for EventService DI.
 */
export abstract class AbstractEventService implements EventService {
    emit<TEvent extends BaseEventData = BaseEventData>(eventType: ServiceEventType, data: TEvent, context?: EventContext): void {
        void eventType;
        void data;
        void context;
        // Default: no-op
    }

    trackExecution(executionId: string, parentExecutionId?: string, level?: number): void {
        void executionId;
        void parentExecutionId;
        void level;
        // Default: no-op
    }

    createBoundEmit(executionId: string): (eventType: ServiceEventType, data: ServiceEventData) => void {
        void executionId;
        return (eventType: ServiceEventType, data: ServiceEventData): void => {
            this.emit(eventType, data);
        };
    }

    createContextBoundInstance(executionContext: ToolExecutionContext): EventService {
        void executionContext;
        return this;
    }
}

class DefaultNoopEventService extends AbstractEventService {
    override emit<TEvent extends BaseEventData = BaseEventData>(eventType: ServiceEventType, data: TEvent, context?: EventContext): void {
        void eventType;
        void data;
        void context;
        // Explicit no-op
    }
}

// Default no-op instance for safe DI when no EventService is provided.
export const DEFAULT_ABSTRACT_EVENT_SERVICE: EventService = new DefaultNoopEventService();

export const isDefaultEventService = (eventService: EventService): boolean => eventService === DEFAULT_ABSTRACT_EVENT_SERVICE;

const mergeOwnerPathSegments = (base?: OwnerPathSegment[], extension?: OwnerPathSegment[]): OwnerPathSegment[] => {
    const segments: OwnerPathSegment[] = [];
    if (base?.length) {
        segments.push(...base.map(segment => ({ ...segment })));
    }
    if (extension?.length) {
        segments.push(...extension.map(segment => ({ ...segment })));
    }
    return segments;
};

const isNonEmptyString = (value: unknown): value is string => typeof value === 'string' && value.length > 0;

class OwnerBoundEventService extends AbstractEventService {
    constructor(
        private readonly baseEventService: EventService,
        private readonly ownerBinding: EventServiceOwnerBinding
    ) {
        super();
    }

    override emit<TEvent extends BaseEventData = BaseEventData>(eventType: ServiceEventType, data: TEvent, context?: EventContext): void {
        const timestamp = data.timestamp ?? context?.timestamp ?? new Date();
        const resolvedSourceType = data.sourceType ?? this.ownerBinding.sourceType;
        const resolvedSourceId = data.sourceId ?? this.ownerBinding.sourceId;

        if (!resolvedSourceType || !resolvedSourceId) {
            throw new Error('[EVENT-SERVICE] Missing sourceType/sourceId for owner-bound emission');
        }

        // ownerPath is a single authoritative value per emission:
        // - If the caller provides context.ownerPath, it MUST be the full absolute ownerPath
        //   and MUST end with the bound owner segment (ownerType/ownerId).
        // - Otherwise, use the ownerBinding.ownerPath of this owner-bound EventService.
        const boundOwnerType = this.ownerBinding.ownerType;
        const boundOwnerId = this.ownerBinding.ownerId ?? resolvedSourceId;

        const resolvedOwnerPath: OwnerPathSegment[] = (() => {
            if (context?.ownerPath?.length) {
                const provided = context.ownerPath.map(segment => ({ ...segment }));
                const last = provided[provided.length - 1];
                if (!last || last.type !== boundOwnerType || last.id !== boundOwnerId) {
                    throw new Error('[EVENT-SERVICE] Invalid context.ownerPath for owner-bound emission (last segment must match bound ownerType/ownerId)');
                }
                return provided;
            }

            if (this.ownerBinding.ownerPath?.length) {
                return this.ownerBinding.ownerPath.map(segment => ({ ...segment }));
            }

            // Strict policy: owner-bound services must have a path; do not fabricate alternative flows.
            throw new Error('[EVENT-SERVICE] Missing ownerPath for owner-bound emission');
        })();

        const resolvedContext: EventContext = {
            ownerType: boundOwnerType,
            ownerId: boundOwnerId,
            ownerPath: resolvedOwnerPath,
            sourceId: resolvedSourceId,
            timestamp
        };

        this.baseEventService.emit(
            eventType,
            {
                ...data,
                sourceType: resolvedSourceType,
                sourceId: resolvedSourceId,
                timestamp
            } as TEvent,
            resolvedContext
        );
    }

    override trackExecution(executionId: string, parentExecutionId?: string, level?: number): void {
        this.baseEventService.trackExecution?.(executionId, parentExecutionId, level);
    }

    override createContextBoundInstance(executionContext: ToolExecutionContext): EventService {
        const ownerType = executionContext.ownerType as OwnerType | (string & {});
        if (!isNonEmptyString(ownerType)) {
            throw new Error('[EVENT-SERVICE] Missing ownerType for createContextBoundInstance');
        }

        const ownerIdCandidate = executionContext.ownerId ?? executionContext.executionId;
        if (!isNonEmptyString(ownerIdCandidate)) {
            throw new Error('[EVENT-SERVICE] Missing ownerId/executionId for createContextBoundInstance');
        }

        const ownerPathProvided = executionContext.ownerPath?.length
            ? executionContext.ownerPath.map(segment => ({ ...segment }))
            : undefined;

        let ownerPath: OwnerPathSegment[];
        if (ownerPathProvided) {
            const last = ownerPathProvided[ownerPathProvided.length - 1];
            if (!last || last.type !== ownerType || last.id !== ownerIdCandidate) {
                throw new Error('[EVENT-SERVICE] Invalid ownerPath for createContextBoundInstance (last segment must match ownerType/ownerId)');
            }
            ownerPath = ownerPathProvided;
        } else {
            const parentPath = this.ownerBinding.ownerPath ?? [];
            ownerPath = [
                ...parentPath.map(segment => ({ ...segment })),
                { type: ownerType, id: ownerIdCandidate }
            ];
        }

        const childBinding: EventServiceOwnerBinding = {
            ownerType,
            ownerId: ownerIdCandidate,
            ownerPath,
            sourceType: ownerType,
            sourceId: executionContext.sourceId ?? ownerIdCandidate
        };
        return new OwnerBoundEventService(this.baseEventService, childBinding);
    }
}

export const bindEventServiceOwner = (eventService: EventService, binding: EventServiceOwnerBinding): EventService => {
    if (isDefaultEventService(eventService)) {
        return eventService;
    }
    return new OwnerBoundEventService(eventService, binding);
};

/**
 * bindWithOwnerPath
 *
 * Canonical ownerPath binder for EventService DI.
 * This is the single helper that should be used for creating owner-bound instances.
 */
export const bindWithOwnerPath = (eventService: EventService, binding: EventServiceOwnerBinding): EventService => {
    return bindEventServiceOwner(eventService, binding);
};

/**
 * Default console event service - Basic logging implementation
 * Useful for development and debugging
 */
export class DefaultEventService extends AbstractEventService {
    private readonly logger: SimpleLogger;

    constructor(logger?: SimpleLogger) {
        super();
        this.logger = logger || DefaultConsoleLogger;
    }

    override emit<TEvent extends BaseEventData = BaseEventData>(eventType: ServiceEventType, data: TEvent, context?: EventContext): void {
        const timestamp = data.timestamp || new Date();
        const ownerPathIds = context?.ownerPath?.length
            ? context.ownerPath.map(seg => String(seg.id ?? '')).filter(Boolean)
            : [];
        const logData = {
            eventType,
            sourceType: data.sourceType,
            sourceId: data.sourceId,
            timestamp: timestamp.toISOString(),
            ownerPath: ownerPathIds,
            ownerContext: context,
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
export class StructuredEventService extends AbstractEventService {
    private readonly logger: SimpleLogger;

    constructor(logger?: SimpleLogger) {
        super();
        this.logger = logger || DefaultConsoleLogger;
    }

    override emit<TEvent extends BaseEventData = BaseEventData>(eventType: ServiceEventType, data: TEvent, context?: EventContext): void {
        const timestamp = data.timestamp || new Date();
        const eventId = this.generateEventId();
        const ownerPathIds = context?.ownerPath?.length
            ? context.ownerPath.map(seg => String(seg.id ?? '')).filter(Boolean)
            : [];

        const structuredEvent = {
            id: eventId,
            type: eventType,
            timestamp: timestamp.toISOString(),
            source: {
                type: data.sourceType,
                id: data.sourceId
            },
            ownerPath: ownerPathIds,
            payload: {
                ...(context && { ownerContext: context }),
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