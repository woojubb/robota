/**
 * Event-related helpers for the Robota agent class.
 *
 * Extracted from core/robota.ts to keep that file under 300 lines.
 * Handles agent event emission and owner path construction.
 */
import { AGENT_EVENTS, AGENT_EVENT_PREFIX } from '../agents/constants';
import type {
  IEventService,
  IOwnerPathSegment,
  IAgentEventData,
} from '../interfaces/event-service';
import { isDefaultEventService } from '../event-service/index';
import type { IAgentConfig, IExecutionContextInjection } from '../interfaces/agent';
import { EventEmitterPlugin } from '../plugins/event-emitter-plugin';
import { EVENT_EMITTER_EVENTS } from '../plugins/event-emitter/types';

/**
 * Emit the AGENT_EVENTS.CREATED event with tool and model parameters.
 */
export function emitCreatedEvent(
  config: IAgentConfig,
  emitFn: (eventType: string, data: Omit<IAgentEventData, 'timestamp'>) => void,
): void {
  const toolNames: string[] = Array.isArray(config.tools)
    ? config.tools
        .map((t) => {
          const sn = t?.schema?.name;
          if (typeof sn === 'string' && sn.length > 0) return sn;
          const nm = (t as { name?: string } | undefined)?.name;
          if (typeof nm === 'string' && nm.length > 0) return nm;
          return '';
        })
        .filter((n): n is string => typeof n === 'string' && n.length > 0)
    : [];
  emitFn(AGENT_EVENTS.CREATED, {
    parameters: {
      tools: toolNames,
      systemMessage: config.defaultModel.systemMessage,
      provider: config.defaultModel.provider,
      model: config.defaultModel.model,
      temperature: config.defaultModel.temperature,
      maxTokens: config.defaultModel.maxTokens,
    },
  });
}

/**
 * Emit an agent event via the agentEventService.
 * No-ops when the service is the default (no-op) implementation.
 */
export function emitAgentEvent(
  agentEventService: IEventService,
  conversationId: string,
  executionContext: IExecutionContextInjection | undefined,
  eventType: string,
  data: Omit<IAgentEventData, 'timestamp'>,
): void {
  if (isDefaultEventService(agentEventService)) return;
  agentEventService.emit(
    eventType,
    { timestamp: new Date(), ...data },
    {
      ownerType: AGENT_EVENT_PREFIX,
      ownerId: conversationId,
      ownerPath: buildOwnerPath(conversationId, executionContext),
    },
  );
}

/**
 * Create an EventEmitterPlugin configured for module lifecycle events.
 * Used by the Robota constructor to avoid a 14-line inline EventEmitterPlugin instantiation.
 */
export function createModuleEventEmitter(): EventEmitterPlugin {
  return new EventEmitterPlugin({
    enabled: true,
    events: [
      EVENT_EMITTER_EVENTS.MODULE_INITIALIZE_START,
      EVENT_EMITTER_EVENTS.MODULE_INITIALIZE_COMPLETE,
      EVENT_EMITTER_EVENTS.MODULE_INITIALIZE_ERROR,
      EVENT_EMITTER_EVENTS.MODULE_EXECUTION_START,
      EVENT_EMITTER_EVENTS.MODULE_EXECUTION_COMPLETE,
      EVENT_EMITTER_EVENTS.MODULE_EXECUTION_ERROR,
      EVENT_EMITTER_EVENTS.MODULE_DISPOSE_START,
      EVENT_EMITTER_EVENTS.MODULE_DISPOSE_COMPLETE,
      EVENT_EMITTER_EVENTS.MODULE_DISPOSE_ERROR,
    ],
  });
}

/**
 * Build the owner path segment array for an agent.
 */
export function buildOwnerPath(
  conversationId: string,
  executionContext?: IExecutionContextInjection,
): IOwnerPathSegment[] {
  const base = executionContext?.ownerPath?.length
    ? executionContext.ownerPath.map((segment) => ({ ...segment }))
    : [];
  return [...base, { type: 'agent', id: conversationId }];
}
