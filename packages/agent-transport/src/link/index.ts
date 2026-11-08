/**
 * `@robota-sdk/agent-transport/link` — the owner link carrier. It runs the `agent-keyring` owner
 * link handshake and frame protection over a local byte stream (a supervised runtime's control
 * socket or pipe), carries the unchanged session protocol of `agent-transport` in sealed frames,
 * and owns the owner vocabulary: trust-root install, read grants, lock, the accept question and the
 * runtime's existing control commands. Wire shapes stop here; a runtime answers through the
 * domain-typed desk and session ports, and decides there what each standing may do.
 */
export { LINK_PROTOCOL, LINK_REQUEST_LINE, isLinkRequest } from './link-request.js';
export {
  DEFAULT_CLOSE_FLUSH_TIMEOUT_MS,
  DEFAULT_HANDSHAKE_TIMEOUT_MS,
  serveRuntimeLink,
} from './serve-runtime-link.js';
export type {
  IAdmittedRuntimeLink,
  IRuntimeLinkDeps,
  IRuntimeLinkPorts,
} from './serve-runtime-link.js';
export { DEFAULT_OPEN_TIMEOUT_MS, openOwnerLink, openSpawnerLink } from './open-runtime-link.js';
export type {
  ILinkSessionChannel,
  IOpenRuntimeLinkOptions,
  IOwnerRuntimeLinkClient,
  IRuntimeLinkClient,
} from './open-runtime-link.js';
export { OwnerLinkClosedError, OwnerRequestRefusedError } from './link-ports.js';
export type {
  ILinkSessionSink,
  IOwnerControlRequest,
  IOwnerLinkDesk,
  IOwnerLinkSessions,
  IRuntimeCustodyState,
  TGrantOutcome,
  TOwnerControlResult,
  TOwnerControlValue,
  TRequestedLockReason,
} from './link-ports.js';
export {
  DEFAULT_SPAWNER_PAIR_TIMEOUT_MS,
  SPAWNER_PAIR_FD,
  SpawnerPairError,
  answerSpawnerPair,
  completeSpawnerPair,
} from './spawner-pair.js';
export type {
  ICompleteSpawnerPairOptions,
  ISpawnerPairIo,
  ISpawnerPairResult,
} from './spawner-pair.js';
export { openSelectedOwnerLink, openSelectedSpawnerLink } from './selected-link.js';
