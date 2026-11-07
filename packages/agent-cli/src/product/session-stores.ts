/**
 * The one module in the product that builds a conversation store — a session store, the prompt
 * history, the tool-result spill, the edit checkpoints — and so the one place that decides how they
 * seal: a store a later process reads states the answer of {@link resolveProductSessionSealing}, and
 * one only this process reads back states {@link resolveProductTransientSealing}, so the
 * composition's stores and every command's own store agree. Only this file knows that decision, so
 * the lint rule in the repository's ESLint config refuses a value import of any store constructor in
 * the product packages outside it: a store built elsewhere could write plaintext beside sealed files.
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
  createWorkspaceProjectMutation,
  getWorkspaceProjectStateStorage,
} from '@robota-sdk/agent-framework';
import {
  EditCheckpointStore,
  createDirectoryEditCheckpointState,
  createNodeToolResultSpillStore,
  createProjectSessionStore,
  createUserPromptHistoryFile,
  createUserSessionStore,
} from '@robota-sdk/agent-framework/node';
import { compactPromptHistoryFile, inspectPromptHistoryFile } from '@robota-sdk/agent-session/node';

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
import type { IArtifactSealer } from '@robota-sdk/agent-core';
import type {
  IEditCheckpointStore,
  IHostToolResultSpillStore,
  ITrustedWorkspaceProjectAccess,
} from '@robota-sdk/agent-framework';
import type { IEditCheckpointStateStorage } from '@robota-sdk/agent-framework/node';
import type {
  IInteractiveSessionStore,
  IPromptHistorySource,
  IPromptHistoryWriter,
} from '@robota-sdk/agent-interface-session';
import type {
  ICompactPromptHistoryOptions,
  TPromptHistoryCompaction,
  TPromptHistoryInspection,
} from '@robota-sdk/agent-session/node';

/**
 * The command a `has_writer` refusal names for a writer marker whose process is not running: the
 * user's own `session release`, which looks in both stores' claims.
 */
export function productSessionReleaseCommand(
  runtime: ICliRuntimeContext,
): (sessionId: string) => string {
  return (sessionId) => `${runtime.config.identity.cliName} session release ${sessionId} --force`;
}

/** The user's own session store, shared by every workspace that keeps its sessions there. */
export function createProductUserSessionStore(
  runtime: ICliRuntimeContext,
): IInteractiveSessionStore {
  const sealing = resolveProductSessionSealing(runtime);
  enterProductStores(runtime);
  return createUserSessionStore(runtime.layout.userPaths.sessions, {
    sealing,
    releaseCommand: productSessionReleaseCommand(runtime),
  });
}

/** A trusted workspace's own session store, with its replay logs. */
export function createProductProjectSessionStore(
  authority: ITrustedWorkspaceProjectAccess['authority'],
  runtime: ICliRuntimeContext,
): IInteractiveSessionStore {
  const sealing = resolveProductSessionSealing(runtime);
  enterProductStores(runtime);
  return createProjectSessionStore(
    getWorkspaceProjectStateStorage(authority, 'sessions'),
    getWorkspaceProjectStateStorage(authority, 'session-logs'),
    {
      sealing,
      releaseCommand: productSessionReleaseCommand(runtime),
    },
  );
}

/** Where a migration sealed session records: the user's own store, or a trusted project's. */
export type TMigratedSessionStore =
  | { readonly kind: 'user'; readonly sessions: string }
  | { readonly kind: 'project'; readonly authority: ITrustedWorkspaceProjectAccess['authority'] };

/** What raising one store's migrated records to the owner's did, record by record. */
export interface IMigratedRecordsAdoption {
  readonly adopted: number;
  /**
   * Not raised: the keys locked before the raise, and the store that would raise them at the next
   * unlock is this call's own, which ends with it.
   */
  readonly locked: number;
  /** Changed after the run sealed them, so left unverified. */
  readonly changed: number;
  /** The ids of records open in another process (their writer marker stands), so not raised. */
  readonly held: readonly string[];
  /** Could not be raised at all, and the name of the first error that stopped one; left unverified. */
  readonly failed: number;
  readonly failure?: string;
}

/**
 * Raises the session records a migration sealed to the owner's, by the digest of exactly the bytes it
 * sealed, once the person said they are theirs (`secure migrate`): through a store that seals with
 * the run's own unlocked sealer, which tags each in place. Built under the migration's marker, so it
 * does not enter the stores as a running product process does. A record open in another process (its
 * writer marker stands) is skipped and named, a record changed since is not raised,
 * one the locked keys could not tag is counted as not raised (nothing here outlives the call to tag
 * it at an unlock), and one whose raise fails does not stop the others. Throws when the store cannot
 * be opened at all.
 */
export function adoptMigratedSessionRecords(
  target: TMigratedSessionStore,
  sealer: IArtifactSealer,
  records: readonly { readonly id: string; readonly digest: string }[],
): IMigratedRecordsAdoption {
  const options = { sealing: { sealer } } as const;
  const store =
    target.kind === 'user'
      ? createUserSessionStore(target.sessions, options)
      : createProjectSessionStore(
          getWorkspaceProjectStateStorage(target.authority, 'sessions'),
          getWorkspaceProjectStateStorage(target.authority, 'session-logs'),
          options,
        );
  const counts = { adopted: 0, locked: 0, changed: 0, failed: 0 };
  const held: string[] = [];
  let failure: string | undefined;
  for (const { id, digest } of records) {
    let result: string;
    try {
      result = store.authorship?.adopt(id, digest) ?? 'changed';
    } catch (error) {
      counts.failed += 1;
      failure ??= error instanceof Error ? error.name : 'unknown';
      continue;
    }
    if (result === 'adopted') counts.adopted += 1;
    else if (result === 'pending') counts.locked += 1;
    else if (result === 'has_writer') held.push(id);
    else counts.changed += 1;
  }
  return failure === undefined ? { ...counts, held } : { ...counts, held, failure };
}

/** The user's prompt history: the Ctrl+R search's source and the interactive session's writer. */
export function createProductPromptHistoryFile(
  runtime: ICliRuntimeContext,
): IPromptHistoryWriter & IPromptHistorySource {
  const sealing = resolveProductSessionSealing(runtime);
  enterProductStores(runtime);
  return createUserPromptHistoryFile(userPaths(runtime).history, {
    sealing,
  });
}

/**
 * Where this run spills oversized tool results: a directory of its own in the owner-only state
 * root, never the shared temporary directory.
 */
export function createProductToolResultSpillStore(
  runtime: ICliRuntimeContext,
  options: { readonly onCleanupFailure?: (reason: 'cleanup-failed') => void } = {},
): IHostToolResultSpillStore {
  const sealing = resolveProductTransientSealing(runtime);
  enterProductStores(runtime);
  return createNodeToolResultSpillStore({
    parentDirectory: prepareSpillParentDirectory(runtime),
    sealing,
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
): () => IEditCheckpointStore {
  const sealing = options.ephemeral
    ? resolveProductTransientSealing(runtime)
    : resolveProductSessionSealing(runtime);
  enterProductStores(runtime);
  const ephemeralState = options.ephemeral ? ephemeralCheckpointState(runtime) : undefined;
  return () => {
    const keysLocked = resolveProductKeysLocked(runtime);
    return new EditCheckpointStore({
      authority,
      mutation: createWorkspaceProjectMutation(authority, {
        status: 'approved',
        purpose: 'restore files from an edit checkpoint',
      }),
      // A persisting session's checkpoints stay in the project's own checkpoint directory (no
      // `stateStorage`), sealed as its record is. An ephemeral run's directory was made for this
      // process alone, so it never held a plain checkpoint and one found there was planted.
      ...(ephemeralState === undefined
        ? { sealing }
        : {
            sealing,
            stateStorage: ephemeralState(),
            sealedOnly: true,
          }),
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
      state = createDirectoryEditCheckpointState(directory);
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
