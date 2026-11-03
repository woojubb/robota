/**
 * The Node-only surface of `agent-core` (CORE-028).
 *
 * `agent-core` declares a `browser` export condition, and that build was produced from the same
 * kitchen-sink barrel as the Node build — a barrel that re-exports modules importing
 * `node:child_process`, `node:fs` and `node:path`. Building one condition from a barrel that cannot
 * satisfy it is the defect, and the workaround made it worse: aliasing `fs` to `false` resolves it
 * to an empty object, turning a build-time contract violation into a deferred silent `TypeError` in
 * a user's browser.
 *
 * So the Node-only pieces live behind their own entry point rather than in the shared barrel. A
 * consumer that needs them says so by importing from here, and the browser build cannot reach them
 * by accident.
 */
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
export {
  removeDirectoryOnProcessExit,
  removeProcessScopedDirectoriesNow,
} from './utils/process-exit-removals.js';
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
