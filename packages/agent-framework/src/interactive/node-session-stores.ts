import { dirname } from 'node:path';

import {
  NodePromptHistoryFile,
  NodeSessionStore,
  NodeToolResultSpillStore,
  sessionSealingOf,
  sweepStaleToolResultSpillDirectories as sessionSweepStaleToolResultSpillDirectories,
} from '@robota-sdk/agent-session/node';

import { WorkspaceProjectSessionStore } from './workspace-session-store.js';

import type { IHostToolResultSpillStore, IInteractiveSessionStore } from './session-store-types.js';
import type { IWorkspaceProjectStateStorage } from '../workspace-trust/index.js';
import type { IPromptHistorySource, IPromptHistoryWriter } from '@robota-sdk/agent-interface/session';
import type {
  INodeSessionStoreOptions,
  INodeToolResultSpillStoreOptions,
  ISessionStoreOptions,
} from '@robota-sdk/agent-session/node';

/**
 * Explicit host-owned storage for bounded MCP result references, in `options.parentDirectory`: an
 * owner-only directory the host owns; spilled results never go anywhere else. `options.sealing`
 * (required) seals each result with `{ sealer }`, or states `'plain'`.
 */
export function createNodeToolResultSpillStore(
  options: INodeToolResultSpillStoreOptions,
): IHostToolResultSpillStore {
  return new NodeToolResultSpillStore(options);
}

/**
 * Remove the spill directories under `parent` whose recorded owner can no longer be alive. A host
 * calls this once at startup for the parent it hands to {@link createNodeToolResultSpillStore}.
 */
export function sweepStaleToolResultSpillDirectories(parent: string): readonly string[] {
  return sessionSweepStaleToolResultSpillDirectories(parent);
}

/**
 * Project session store over a trusted workspace's state facets. `options.sealing` (required) seals
 * its records with `{ sealer }`, or states `'plain'`.
 */
export function createProjectSessionStore(
  sessions: IWorkspaceProjectStateStorage,
  logs: IWorkspaceProjectStateStorage,
  options: ISessionStoreOptions,
): IInteractiveSessionStore {
  return new WorkspaceProjectSessionStore(sessions, logs, options);
}

/**
 * Explicit host-filesystem session store. This does not establish project trust. `options.sealing`
 * is required, as for {@link createProjectSessionStore}; `options.ownedRoot` is an ancestor of
 * `baseDirectory` the host also owns, tightened along with it.
 */
export function createNodeHostSessionStore(
  baseDirectory: string,
  options: INodeSessionStoreOptions,
): IInteractiveSessionStore {
  return new NodeSessionStore(baseDirectory, options);
}

/**
 * The caller-selected prompt-history file, one object serving
 * both the session-side writer and the surface's newest-first source. The user root is
 * passed as OWNED, exactly as `createUserSessionStore` does, so it is tightened along with the file.
 * `options.sealing` (required) seals each entry as one line with `{ sealer }`, or states `'plain'`.
 */
export function createUserPromptHistoryFile(
  history: string,
  options: ISessionStoreOptions,
): IPromptHistoryWriter & IPromptHistorySource {
  return new NodePromptHistoryFile(history, {
    ownedRoot: dirname(history),
    sealing: sessionSealingOf(options),
  });
}

/**
 * User-level session store at a caller-selected directory. Symmetric to {@link createProjectSessionStore};
 * there is no user-level replay-log directory, so it reads persisted records only. `options.sealing`
 * as for {@link createProjectSessionStore}.
 */
export function createUserSessionStore(
  sessions: string,
  options: ISessionStoreOptions,
): IInteractiveSessionStore {
  // The user store root is passed as OWNED, so it is tightened along with the sessions
  // directory inside it. The caller owns the layout and supplies this path.
  // This is the path the restricted-workspace fallback takes, where no other writer may ever run
  // to tighten the root on its behalf.
  return new NodeSessionStore(sessions, {
    ownedRoot: dirname(sessions),
    sealing: sessionSealingOf(options),
    ...(options.releaseCommand === undefined ? {} : { releaseCommand: options.releaseCommand }),
  });
}
