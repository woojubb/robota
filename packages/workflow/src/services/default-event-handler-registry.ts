import { SilentLogger, type ILogger } from '@robota-sdk/agents';
import type { IEventHandler } from '../interfaces/event-handler.js';
import { registerAgentEventHandlers } from '../handlers/agent-event-handler.js';
import { registerToolEventHandlers } from '../handlers/tool-event-handler.js';
import { registerExecutionEventHandlers } from '../handlers/execution-event-handler.js';
import { registerUserEventHandlers } from '../handlers/user-event-handler.js';
import { AgentNodeBuilder } from '../handlers/builders/agent-node-builder.js';
import { ExecutionNodeBuilder } from '../handlers/builders/execution-node-builder.js';
import { WorkflowInstanceRegistry } from './instance-registry.js';

export interface IDefaultEventHandlerRegistryConfig {
    registerHandler: (handler: IEventHandler) => void;
    logger?: ILogger;
    agentNodeBuilder: AgentNodeBuilder;
    executionNodeBuilder: ExecutionNodeBuilder;
    instanceRegistry: WorkflowInstanceRegistry;
}

export function registerDefaultEventHandlers(config: IDefaultEventHandlerRegistryConfig): void {
    const logger = config.logger ?? SilentLogger;
    registerAgentEventHandlers(
        config.registerHandler,
        logger,
        config.agentNodeBuilder,
        config.instanceRegistry
    );
    registerToolEventHandlers(
        config.registerHandler,
        logger,
        config.instanceRegistry
    );
    registerExecutionEventHandlers(
        config.registerHandler,
        logger,
        config.executionNodeBuilder,
        config.agentNodeBuilder,
        config.instanceRegistry
    );
    registerUserEventHandlers(
        config.registerHandler,
        logger,
        config.executionNodeBuilder
    );
}
