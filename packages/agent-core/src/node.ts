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
export type { IOwnerOnlyIo } from './utils/owner-only-store.js';
export {
  OWNER_ONLY_DIRECTORY_MODE,
  OWNER_ONLY_FILE_MODE,
  OwnerOnlyModeError,
  ensureOwnerOnlyDirectory,
  ownerOnlyGuarantee,
  tightenExistingFile,
  writeOwnerOnlyFile,
} from './utils/owner-only-store.js';
export { CommandExecutor, HttpExecutor } from './hooks/executors/index.js';

// #2026: the shared egress boundary is Node-only (node:dns, node:net) and lives on this subpath.
export {
  BLOCKED_HOSTNAMES,
  fetchWithEgressPolicy,
  isPrivateAddress,
  rejectDestination,
} from './utils/egress-policy.js';
export type {
  IEgressDeps,
  IEgressFetchOptions,
  IEgressPolicy,
  IEgressRejection,
  TEgressFetchResult,
  TEgressLookup,
  TEgressRejectionReason,
} from './utils/egress-policy.js';
