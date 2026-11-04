/**
 * The Node-only surface of `agent-core`.
 *
 * The main entry is platform-neutral (ARCHITECTURE.md "Runtime platforms"): it never reaches a Node
 * built-in or global, not even through a lazy import. Everything that needs a Node host — files,
 * processes, sockets, the process environment — lives here, and a composition root that has that
 * host injects it into the neutral code.
 */
export { processEnvResolver } from './utils/process-env-resolver.js';
export {
  UnsupportedShellError,
  resolvePlatformShell,
  type IPlatformShell,
  type IPlatformShellResolutionRequest,
  type TShellKind,
} from './utils/platform-shell.js';
export {
  canonicalizePath,
  isPathInside,
  resolveTrustedExecutionRoot,
} from './utils/path-containment.js';
export type {
  IOwnerOnlyDurability,
  IOwnerOnlyIo,
  IStagedOwnerOnlyFile,
  IWriteOwnerOnlyFileOptions,
} from './utils/owner-only-store.js';
export {
  OWNER_ONLY_DIRECTORY_MODE,
  OWNER_ONLY_FILE_MODE,
  OwnerOnlyModeError,
  OwnerOnlyWriteUnconfirmedError,
  ensureOwnerOnlyDirectory,
  ownerOnlyGuarantee,
  stageOwnerOnlyFile,
  tightenExistingFile,
  writeOwnerOnlyFile,
} from './utils/owner-only-store.js';
export type {
  ICreateProcessScopedDirectoryOptions,
  IProcessScopedDirectoryEntry,
  ISweepProcessScopedDirectoriesOptions,
  TProcessOwnerLiveness,
} from './utils/process-scoped-directory.js';
export {
  PROCESS_OWNER_RECORD_NAME,
  createProcessScopedDirectory,
  inspectProcessScopedDirectories,
  processScopedDirectoryPrefix,
  sweepStaleProcessScopedDirectories,
} from './utils/process-scoped-directory.js';
export type { IProcessOwnerProbes } from './utils/process-owner-record.js';
export {
  classifyProcessOwner,
  ownerOnThisMachine,
  serializeProcessOwnerRecord,
} from './utils/process-owner-record.js';
export type {
  IProcessMarkerSteps,
  IProcessMarkersOptions,
  TProcessMarkerMemory,
} from './utils/process-marker.js';
export {
  PROCESS_MARKER_BREAK_LOCK_STALE_MS,
  PROCESS_MARKER_SUFFIX,
  ProcessMarkerError,
  createProcessMarkerMemory,
  createProcessMarkers,
} from './utils/process-marker.js';
export { removeDirectoryOnProcessExit, runProcessEndNow } from './utils/process-exit-removals.js';
export type {
  IEnableOwnChildSessionsOptions,
  IExecFileInChildSessionOptions,
  TChildSessionOptions,
  TExecFileCallback,
} from './utils/child-session.js';
export {
  enableOwnChildSessions,
  endWithProcess,
  execFileInChildSession,
  signalChildGroup,
  withChildSession,
} from './utils/child-session.js';
export type {
  IProcessIdentity,
  IReadMachineIdOptions,
  IReadProcessStartTimeOptions,
} from './utils/process-identity.js';
export {
  readBootId,
  readCurrentProcessIdentity,
  readDarwinStartTime,
  readMachineId,
  readPidNamespace,
  readProcessStartTime,
} from './utils/process-identity.js';
export { CommandExecutor, HttpExecutor } from './hooks/executors/index.js';

// #2026: the shared egress boundary is Node-only (node:dns, node:net) and lives on this subpath.
export {
  BLOCKED_HOSTNAMES,
  fetchWithEgressPolicy,
  isPrivateAddress,
  openEgressExchange,
  postWithEgressPolicy,
  rejectDestination,
} from './utils/egress-policy.js';
export type {
  IEgressDeps,
  IEgressExchange,
  IEgressFetchOptions,
  IEgressPolicy,
  IEgressPostOptions,
  IEgressRejection,
  TEgressFetchResult,
  TEgressLookup,
  TEgressRejectionReason,
} from './utils/egress-policy.js';
