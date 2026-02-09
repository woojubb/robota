import { SilentLogger, type ILogger, type IEventHistoryModule, type IEventHistoryRecord } from '@robota-sdk/agents';
import type { IEventHandler } from '../interfaces/event-handler.js';
import type { TWorkflowUpdate } from '../interfaces/workflow-builder.js';
import type { TEventLogRecord } from '../interfaces/event-log.js';
import type { IWorkflowProjection } from '../interfaces/event-projection.js';
import { registerAgentEventHandlers } from '../handlers/agent-event-handler.js';
import { registerToolEventHandlers } from '../handlers/tool-event-handler.js';
import { registerExecutionEventHandlers } from '../handlers/execution-event-handler.js';
import { registerUserEventHandlers } from '../handlers/user-event-handler.js';
import { AgentNodeBuilder } from '../handlers/builders/agent-node-builder.js';
import { ExecutionNodeBuilder } from '../handlers/builders/execution-node-builder.js';
import { WorkflowInstanceRegistry } from './instance-registry.js';

export class WorkflowProjection implements IWorkflowProjection {
    private logger: ILogger;
    private handlers = new Map<string, IEventHandler>();
    private instanceRegistry = new WorkflowInstanceRegistry();
    private agentNodeBuilder: AgentNodeBuilder;
    private executionNodeBuilder: ExecutionNodeBuilder;
    private historyModule: IEventHistoryModule | undefined;

    constructor(logger: ILogger = SilentLogger, historyModule?: IEventHistoryModule) {
        this.logger = logger;
        this.agentNodeBuilder = new AgentNodeBuilder(this.logger);
        this.executionNodeBuilder = new ExecutionNodeBuilder();
        this.historyModule = historyModule;
        this.registerHandlers();
    }

    async apply(record: TEventLogRecord): Promise<TWorkflowUpdate[]> {
        const handler = this.handlers.get(record.eventName);
        if (!handler) {
            throw new Error(`[WORKFLOW-PROJECTION] No handler for event: ${record.eventName}`);
        }
        if (record.payload.eventType !== record.eventName) {
            throw new Error(
                `[WORKFLOW-PROJECTION] Event name mismatch: record=${record.eventName} payload=${record.payload.eventType}`
            );
        }
        const result = await handler.handle(record.payload);
        return result.updates;
    }

    async applyFromHistory(fromSequenceId: number, toSequenceId?: number): Promise<TWorkflowUpdate[]> {
        if (!this.historyModule) {
            throw new Error('[WORKFLOW-PROJECTION] HistoryModule is required for history projection.');
        }
        if (fromSequenceId < 1) {
            throw new Error('[WORKFLOW-PROJECTION] fromSequenceId must be >= 1.');
        }
        const records = this.historyModule.read(fromSequenceId, toSequenceId);
        const ordered = [...records].sort((a, b) => a.sequenceId - b.sequenceId);
        const updates: TWorkflowUpdate[] = [];
        for (const record of ordered) {
            const logRecord = this.toEventLogRecord(record);
            const result = await this.apply(logRecord);
            updates.push(...result);
        }
        return updates;
    }

    private registerHandlers(): void {
        const registerHandler = (handler: IEventHandler) => {
            if (this.handlers.has(handler.eventName)) {
                throw new Error(`[WORKFLOW-PROJECTION] Duplicate handler for ${handler.eventName}`);
            }
            this.handlers.set(handler.eventName, handler);
        };
        registerAgentEventHandlers(registerHandler, this.logger, this.agentNodeBuilder, this.instanceRegistry);
        registerToolEventHandlers(registerHandler, this.logger, this.instanceRegistry);
        registerExecutionEventHandlers(
            registerHandler,
            this.logger,
            this.executionNodeBuilder,
            this.agentNodeBuilder,
            this.instanceRegistry
        );
        registerUserEventHandlers(registerHandler, this.logger, this.executionNodeBuilder);
    }

    private toEventLogRecord(record: IEventHistoryRecord): TEventLogRecord {
        const ownerPath = record.context?.ownerPath;
        if (!ownerPath || ownerPath.length === 0) {
            throw new Error(`[WORKFLOW-PROJECTION] Missing ownerPath for ${record.eventName}`);
        }
        const payload = {
            ...record.eventData,
            eventType: record.eventName,
            timestamp: record.eventData.timestamp,
            context: record.context
        };
        return {
            eventName: record.eventName,
            timestamp: record.eventData.timestamp,
            ownerPath,
            payload
        };
    }
}
