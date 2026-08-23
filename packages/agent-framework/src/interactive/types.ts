/**
 * Types for InteractiveSession — event-driven session wrapper.
 *
 * SSOT relocated to @robota-sdk/agent-interface-transport (DATA-001); re-exported here
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
} from '@robota-sdk/agent-interface-transport';
export type { IUsageSnapshot } from '@robota-sdk/agent-interface-analytics';
