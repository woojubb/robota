import type { TToolParameters, TToolResult, TToolExecutionContext } from '../../interfaces/tool';
import type { ToolSchema } from '../../interfaces/provider';
import { AbstractTool, type AbstractToolOptions } from '../../abstracts/abstract-tool';
import type { IEventService, IOwnerPathSegment } from '../../services/event-service';
import { ToolExecutionError } from '../../utils/errors';

export interface RelayMcpContext {
    /** OwnerPath including agent segment appended for this relay execution */
    ownerPath: IOwnerPathSegment[];
    /** Tool-bound EventService (already bound to tool by caller) */
    eventService: IEventService;
    /** Unbound base EventService (required to bind a new owner for created agent) */
    baseEventService: IEventService;
    /** Generated agent identifier for this relay execution */
    agentId: string;
}

export interface RelayMcpOptions extends AbstractToolOptions {
    /** MCP schema describing this relay tool */
    schema: ToolSchema;
    /**
     * Relay executor that performs the actual work (e.g., create Robota agent and run).
     * Must not perform ownerPath inference; receives the augmented agent ownerPath.
     */
    run: (parameters: TToolParameters, ctx: RelayMcpContext) => Promise<TToolResult>;
}

/**
 * RelayMcpTool
 *
 * Minimal relay tool for third-party MCP commands that need to spin up a Robota-based flow.
 * - Caller provides tool-bound EventService and ownerPath (up to tool segment).
 * - This tool appends a single agent segment and forwards control to the provided run() callback.
 * - No prefix injection, no ownerPath inference, no fallback/clone/context creation inside.
 */
export class RelayMcpTool extends AbstractTool<TToolParameters, TToolResult> {
    readonly schema: ToolSchema;
    private readonly runImpl: RelayMcpOptions['run'];

    constructor(options: RelayMcpOptions) {
        super(options);
        this.schema = options.schema;
        this.runImpl = options.run;
    }

    protected override async executeImpl(parameters: TToolParameters, context?: TToolExecutionContext): Promise<TToolResult> {
        const eventService = context?.eventService;
        if (!eventService) {
            throw new ToolExecutionError('RelayMcpTool requires tool-call scoped EventService in ToolExecutionContext', this.schema.name);
        }
        const baseEventService = context?.baseEventService;
        if (!baseEventService) {
            throw new ToolExecutionError('RelayMcpTool requires baseEventService in ToolExecutionContext', this.schema.name);
        }

        const baseOwnerPath = context?.ownerPath;
        if (!baseOwnerPath || baseOwnerPath.length === 0) {
            throw new ToolExecutionError('RelayMcpTool requires ownerPath bound to tool segment', this.schema.name);
        }

        const agentId = `agent_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        const agentOwnerPath: IOwnerPathSegment[] = [
            ...baseOwnerPath.map(segment => ({ ...segment })),
            { type: 'agent', id: agentId }
        ];

        const ctx: RelayMcpContext = {
            ownerPath: agentOwnerPath,
            eventService,
            baseEventService,
            agentId
        };

        return this.runImpl(parameters, ctx);
    }
}

