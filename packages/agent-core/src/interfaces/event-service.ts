/**
 * Event service interface re-exports.
 *
 * These types are owned by @robota-sdk/agent-event-service.
 * This file re-exports them for use within the agents package.
 */
export type {
  IOwnerPathSegment,
  IEventContext,
  IBaseEventData,
  IExecutionEventData,
  IAgentEventData,
  IToolEventData,
  TEventListener,
  IEventService,
  IEventServiceOwnerBinding,
  TEventExtensionValue,
} from '@robota-sdk/agent-event-service';
