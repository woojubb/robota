export { InteractiveSession } from './interactive-session.js';
export type { IInteractiveSession } from './i-interactive-session.js';
export {
  createProjectSessionStore,
  createUserSessionStore,
  listResumableSessionSummaries,
  resolveLatestSessionId,
  resolveSessionIdByIdOrName,
} from './session-persistence.js';
// SEC-006: re-exported so a consumer holding a session id from an untrusted source (e.g. an HTTP
// body) can reject it BEFORE it reaches the store, without taking a direct agent-session dependency.
export { assertSafeSessionId, isSafeSessionId } from '@robota-sdk/agent-session';
export { generateSessionName } from './session-naming.js';
export type { IGenerateSessionNameOptions } from './session-naming.js';
export type {
  TInteractiveSessionOptions,
  IInteractiveSessionShutdownOptions,
} from './interactive-session.js';
export type { ISkillActivationEvent } from '../commands/index.js';
export type {
  IInteractiveSessionRecord,
  IInteractiveSessionStore,
  IResumableSessionSummary,
} from './session-persistence.js';
export type {
  IToolState,
  IDiffLine,
  IExecutionResult,
  IToolSummary,
  IUsageSnapshot,
  TPermissionResultValue,
  TInteractivePermissionHandler,
  TInteractiveEventName,
  IInteractiveSessionEvents,
  IContextFileRefreshedEvent,
} from './types.js';
export type {
  ITransportAdapter,
  IConfigurableTransport,
  ITransportConfig,
} from '@robota-sdk/agent-interface-transport';
