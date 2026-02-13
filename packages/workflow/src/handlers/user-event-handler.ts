/**
 * User event processing logic
 *
 * Handles user.* events and creates appropriate workflow nodes.
 */

import type { ILogger } from '@robota-sdk/agents';
import { SilentLogger, USER_EVENTS, USER_EVENT_PREFIX, composeEventName } from '@robota-sdk/agents';
import type { IEventHandler, TEventData, IEventProcessingResult } from '../interfaces/event-handler.js';
import type { TWorkflowUpdate } from '../interfaces/workflow-builder.js';
import { ExecutionNodeBuilder } from './builders/execution-node-builder.js';

const USER_EVENT_NAMES = {
    MESSAGE: composeEventName(USER_EVENT_PREFIX, USER_EVENTS.MESSAGE),
    INPUT: composeEventName(USER_EVENT_PREFIX, USER_EVENTS.INPUT),
};

class UserEventLogic {
    private logger: ILogger;
    private nodeBuilder: ExecutionNodeBuilder;

    constructor(logger: ILogger = SilentLogger, nodeBuilder: ExecutionNodeBuilder) {
        this.logger = logger;
        this.nodeBuilder = nodeBuilder;
    }

    async handle(eventType: string, eventData: TEventData): Promise<IEventProcessingResult> {
        this.logger.debug(`🔧 [USER-HANDLER] Processing ${eventType}`);
        const handler = this.getHandler(eventType);
        if (!handler) {
            throw new Error(`[USER-HANDLER] Unknown event type: ${eventType}`);
        }
        return handler(eventData);
    }

    private getHandler(eventType: string): ((data: TEventData) => Promise<IEventProcessingResult>) | undefined {
        const handlers: Record<string, (data: TEventData) => Promise<IEventProcessingResult>> = {
            [USER_EVENT_NAMES.MESSAGE]: (data) => this.handleUserMessage(data),
            [USER_EVENT_NAMES.INPUT]: (data) => this.handleUserInput(data)
        };
        return handlers[eventType];
    }

    private async handleUserMessage(eventData: TEventData): Promise<IEventProcessingResult> {
        const updates: TWorkflowUpdate[] = [];
        const userMessageNode = this.nodeBuilder.createUserMessageNode(eventData);
        updates.push({ action: 'create', node: userMessageNode });
        return {
            success: true,
            updates
        };
    }

    private async handleUserInput(eventData: TEventData): Promise<IEventProcessingResult> {
        const updates: TWorkflowUpdate[] = [];
        const userInputNode = this.nodeBuilder.createUserInputNode(eventData);
        updates.push({ action: 'create', node: userInputNode });
        return {
            success: true,
            updates
        };
    }
}

export function registerUserEventHandlers(
    registerHandler: (handler: IEventHandler) => void,
    logger: ILogger = SilentLogger,
    nodeBuilder: ExecutionNodeBuilder
): void {
    const logic = new UserEventLogic(logger, nodeBuilder);
    const handlers: IEventHandler[] = [
        {
            name: 'UserMessageHandler',
            eventName: USER_EVENT_NAMES.MESSAGE,
            handle: (eventData) => logic.handle(USER_EVENT_NAMES.MESSAGE, eventData)
        },
        {
            name: 'UserInputHandler',
            eventName: USER_EVENT_NAMES.INPUT,
            handle: (eventData) => logic.handle(USER_EVENT_NAMES.INPUT, eventData)
        }
    ];
    handlers.forEach(registerHandler);
}
