/**
 * Event service interface re-exports.
 *
 * These types are owned by the local event-service module within agent-core.
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
} from '../event-service/index';
