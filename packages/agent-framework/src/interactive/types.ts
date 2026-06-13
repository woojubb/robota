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
  IUsageSnapshot,
  IExecutionResult,
  IToolSummary,
  TInteractivePermissionHandler,
  IInteractiveSessionEvents,
  IContextFileRefreshedEvent,
  TInteractiveEventName,
} from '@robota-sdk/agent-interface-transport';
