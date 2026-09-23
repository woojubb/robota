/**
 * Types for InteractiveSession — event-driven session wrapper.
 *
 * Session types belong to @robota-sdk/agent-interface-session; usage belongs to
 * @robota-sdk/agent-interface-analytics. They are re-exported here
 * so existing framework import paths and the public surface stay unchanged.
 */

export type {
  TPermissionResultValue,
  IToolState,
  IDiffLine,
  IExecutionResult,
  IToolSummary,
  TInteractivePermissionHandler,
  IInteractiveSessionEvents,
  IContextFileRefreshedEvent,
  TInteractiveEventName,
} from '@robota-sdk/agent-interface-session';
export type { IUsageSnapshot } from '@robota-sdk/agent-interface-analytics';
