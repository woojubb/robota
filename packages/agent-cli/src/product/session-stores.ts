/**
 * The one module in the product that builds a conversation store — a session store, the prompt
 * history, the tool-result spill, the edit checkpoints — and so the one place that decides how they
 * seal: a store a later process reads states the answer of {@link resolveProductSessionSealing}, and
 * one only this process reads back states {@link resolveProductTransientSealing}, so the
 * composition's stores and every command's own store agree. The SDK's store constructors default to
 * plain; the lint rule in the repository's ESLint config refuses a value import of any of them in the
 * product packages outside this file, so no store here can be left on that default.
 *
 * Being the one construction point also makes it where a process marks that it uses the stores
 * (`process-presence.ts`): every factory here enters the stores first, so a process that builds none
 * never pays for it, and none is built while a migration of the state root runs.
 */
import { dirname } from 'node:path';

import { ArtifactLockedError } from '@robota-sdk/agent-core';
import {
  createProcessScopedDirectory,
  removeDirectoryOnProcessExit,
} from '@robota-sdk/agent-core/node';
import {
  EditCheckpointStore,
  createDirectoryEditCheckpointState,
  createNodeToolResultSpillStore,
  createProjectSessionStore,
  createSealedEditCheckpointState,
  createUserPromptHistoryFile,
  createUserSessionStore,
  createWorkspaceProjectMutation,
  getWorkspaceProjectStateStorage,
} from '@robota-sdk/agent-framework';
import { compactPromptHistoryFile, inspectPromptHistoryFile } from '@robota-sdk/agent-session';

import { KeyHolderArtifactSealer } from '../secure/artifact-sealer.js';
import {
  EPHEMERAL_CHECKPOINT_DIRECTORY_PREFIX,
  prepareSpillParentDirectory,
} from '../startup/ephemeral-state.js';
import {
  resolveProductKeysLocked,
  resolveProductSessionSealing,
  resolveProductTransientSealing,
} from './session-sealing.js';
import { enterProductStores } from './process-presence.js';
import { userPaths } from './user-paths.js';

import type { ICliRuntimeContext } from './runtime-context.js';
import type { KeyHolder } from '../secure/key-holder.js';
import type {
  IEditCheckpointStateStorage,
  IHostToolResultSpillStore,
  ITrustedWorkspaceProjectAccess,
} from '@robota-sdk/agent-framework';
import type {
  IInteractiveSessionStore,
  IPromptHistorySource,
  IPromptHistoryWriter,
} from '@robota-sdk/agent-interface-session';
import type {
  ICompactPromptHistoryOptions,
  TPromptHistoryCompaction,
  TPromptHistoryInspection,
} from '@robota-sdk/agent-session';

/** The user's own session store, shared by every workspace that keeps its sessions there. */
export function createProductUserSessionStore(
  runtime: ICliRuntimeContext,
): IInteractiveSessionStore {
  enterProductStores(runtime);
  return createUserSessionStore(runtime.layout.userPaths.sessions, {
    sealing: resolveProductSessionSealing(runtime),
  });
}

/** A trusted workspace's own session store, with its replay logs. */
export function createProductProjectSessionStore(
  authority: ITrustedWorkspaceProjectAccess['authority'],
  runtime: ICliRuntimeContext,
): IInteractiveSessionStore {
  enterProductStores(runtime);
  return createProjectSessionStore(
    getWorkspaceProjectStateStorage(authority, 'sessions'),
    getWorkspaceProjectStateStorage(authority, 'session-logs'),
    { sealing: resolveProductSessionSealing(runtime) },
  );
}

/** The user's prompt history: the Ctrl+R search's source and the interactive session's writer. */
export function createProductPromptHistoryFile(
  runtime: ICliRuntimeContext,
): IPromptHistoryWriter & IPromptHistorySource {
  enterProductStores(runtime);
  return createUserPromptHistoryFile(userPaths(runtime).history, {
    sealing: resolveProductSessionSealing(runtime),
  });
}

/**
 * Where this run spills oversized tool results: a directory of its own in the owner-only state
 * root, never the shared temporary directory the SDK store defaults to.
 */
export function createProductToolResultSpillStore(
  runtime: ICliRuntimeContext,
  options: { readonly onCleanupFailure?: (reason: 'cleanup-failed') => void } = {},
): IHostToolResultSpillStore {
  enterProductStores(runtime);
  return createNodeToolResultSpillStore({
    parentDirectory: prepareSpillParentDirectory(runtime),
    sealing: resolveProductTransientSealing(runtime),
    ...(options.onCleanupFailure === undefined
      ? {}
      : { onCleanupFailure: options.onCleanupFailure }),
  });
}

/**
 * Builds one session's edit checkpoint store; a factory, since a store holds its session's turn in
 * progress and sessions that run at the same time each need their own. A session that persists keeps
 * its checkpoints in the project's checkpoint directory, sealed as its record is, since resuming it
 * later reads them. A run that persists no session (`ephemeral`) keeps them in one owner-only
 * directory of this process, removed at exit, sealed with the process's own key. Either way, while
 * the keyring holder is locked a person's `/rewind` reads are refused.
 */
export function createProductEditCheckpointStoreFactory(
  authority: ITrustedWorkspaceProjectAccess['authority'],
  runtime: ICliRuntimeContext,
  options: { readonly ephemeral: boolean },
): () => EditCheckpointStore {
  enterProductStores(runtime);
  const state = options.ephemeral
    ? ephemeralCheckpointState(runtime)
    : () =>
        createSealedEditCheckpointState(
          getWorkspaceProjectStateStorage(authority, 'checkpoints'),
          resolveProductSessionSealing(runtime),
        );
  return () => {
    const keysLocked = resolveProductKeysLocked(runtime);
    return new EditCheckpointStore({
      authority,
      mutation: createWorkspaceProjectMutation(authority, {
        status: 'approved',
        purpose: 'restore files from an edit checkpoint',
      }),
      stateStorage: state(),
      ...(keysLocked === undefined ? {} : { keysLocked }),
    });
  };
}

/**
 * The one directory every ephemeral store of this process keeps its checkpoints in (stores are keyed
 * by session id, as in the project's directory), made when the first store is, and removed at exit.
 */
function ephemeralCheckpointState(runtime: ICliRuntimeContext): () => IEditCheckpointStateStorage {
  let state: IEditCheckpointStateStorage | undefined;
  return () => {
    if (state === undefined) {
      const directory = createProcessScopedDirectory(
        runtime.layout.userPaths.ephemeralCheckpoints,
        EPHEMERAL_CHECKPOINT_DIRECTORY_PREFIX,
      );
      removeDirectoryOnProcessExit(directory);
      // Made for this process alone, so it never held a plain checkpoint: one found there was planted.
      state = createSealedEditCheckpointState(
        createDirectoryEditCheckpointState(directory),
        resolveProductTransientSealing(runtime),
        { sealedOnly: true },
      );
    }
    return state;
  };
}

/** Hooks a caller of {@link compactProductPromptHistory} may pass on. */
export type TProductPromptHistoryCompactionOptions = Pick<
  ICompactPromptHistoryOptions,
  'beforeCommit' | 'pause'
>;

/**
 * Compacts the user's prompt history (`compactPromptHistoryFile`) under a sealer made for this one
 * compaction over `holder`, so every line it writes shares one writer epoch, sealed to the key the
 * unlock verified. `holder` must be unlocked: the sealed lines are opened to be rewritten. Not a store
 * construction, so it marks no presence: `secure compact` and a migration each call it from under
 * their own marker, which keeps two compactions from renaming over each other.
 */
export async function compactProductPromptHistory(
  runtime: ICliRuntimeContext,
  holder: KeyHolder,
  options: TProductPromptHistoryCompactionOptions = {},
): Promise<TPromptHistoryCompaction> {
  if (!holder.isUnlocked) throw new ArtifactLockedError();
  const history = userPaths(runtime).history;
  const sealer = new KeyHolderArtifactSealer(holder);
  try {
    return await compactPromptHistoryFile(history, {
      sealer,
      ownedRoot: dirname(history),
      ...options,
    });
  } finally {
    sealer.dispose();
  }
}

/** What {@link compactProductPromptHistory} would find in the user's prompt history; writes nothing. */
export function inspectProductPromptHistory(
  runtime: ICliRuntimeContext,
  holder: KeyHolder,
): TPromptHistoryInspection {
  if (!holder.isUnlocked) throw new ArtifactLockedError();
  const sealer = new KeyHolderArtifactSealer(holder);
  try {
    return inspectPromptHistoryFile(userPaths(runtime).history, { sealer });
  } finally {
    sealer.dispose();
  }
}
