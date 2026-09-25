// Utility exports
//
// `path-containment` is NOT here: it imports `node:fs` and `node:path`, and this barrel feeds the
// BROWSER build too (CORE-028). It is exported from `@robota-sdk/agent-core/node`, which is how a
// consumer asks for it — the subpath, not a relative path that depends on where you are reading.
export * from './abort-classification';
export * from './message-converter';
export * from './logger';
export * from './validation';
export * from './error-utils';
export * from './errors';
export {
  classifyProviderFailure,
  readProviderFailureDetails,
  toProviderError,
  type IProviderFailureClassification,
  type TProviderFailureReason,
} from './provider-failure';
export * from './periodic-task';
export * from './platform-shell';
export {
  buildTraceparent,
  isMintedSpanId,
  outboundTraceContextFor,
  providerCallSpanId,
  spanIdFromMintedId,
  subprocessTraceEnvironment,
  toolTraceContextFor,
  traceEnvFor,
  traceHeadersFor,
} from './trace-context';
export type { TTimerId } from './timer-types';
