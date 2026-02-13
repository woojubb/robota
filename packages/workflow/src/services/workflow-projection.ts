import { SilentLogger, type ILogger, type IEventHistoryModule } from '@robota-sdk/agents';
import type { IEventHandler } from '../interfaces/event-handler.js';
import type { TWorkflowUpdate } from '../interfaces/workflow-builder.js';
import type { TEventLogRecord } from '../interfaces/event-log.js';
import type { IWorkflowProjection } from '../interfaces/event-projection.js';
import { AgentNodeBuilder } from '../handlers/builders/agent-node-builder.js';
import { ExecutionNodeBuilder } from '../handlers/builders/execution-node-builder.js';
import { WorkflowInstanceRegistry } from './instance-registry.js';
import { compareEventOrdering } from './event-log-ordering.js';
import { registerDefaultEventHandlers } from './default-event-handler-registry.js';
import { toEventDataFromHistory } from './event-record-adapter.js';

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
        if (!record.context?.ownerPath || record.context.ownerPath.length === 0) {
            throw new Error(`[WORKFLOW-PROJECTION] Missing ownerPath for ${record.eventName}`);
        }
        const handler = this.handlers.get(record.eventName);
        if (!handler) {
            throw new Error(`[WORKFLOW-PROJECTION] No handler for event: ${record.eventName}`);
        }
        const eventData = toEventDataFromHistory(record);
        if (eventData.eventType !== record.eventName) {
            throw new Error(
                `[WORKFLOW-PROJECTION] Event name mismatch: record=${record.eventName} payload=${eventData.eventType}`
            );
        }
        const result = await handler.handle(eventData);
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
        const ordered = [...records].sort((left, right) => compareEventOrdering({
            ownerPath: left.context.ownerPath,
            timestamp: left.timestamp,
            eventName: left.eventName,
            sequenceId: left.sequenceId
        }, {
            ownerPath: right.context.ownerPath,
            timestamp: right.timestamp,
            eventName: right.eventName,
            sequenceId: right.sequenceId
        }));
        const updates: TWorkflowUpdate[] = [];
        for (const record of ordered) {
            const result = await this.apply(record);
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
        registerDefaultEventHandlers({
            registerHandler,
            logger: this.logger,
            agentNodeBuilder: this.agentNodeBuilder,
            executionNodeBuilder: this.executionNodeBuilder,
            instanceRegistry: this.instanceRegistry
        });
    }
}
