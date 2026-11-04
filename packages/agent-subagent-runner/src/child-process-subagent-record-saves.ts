/**
 * #3679 step 3e: how a sealing parent comes to vouch for the fork record its write-only child saved.
 *
 * Sealing needs only the public key, so the child — which holds no keys — writes its fork record
 * untagged, and a record nobody vouched for prompts on its next resume. The parent can vouch for it,
 * but only for exactly the bytes the child wrote, and only when what the child started from was the
 * owner's: so a child handed a record says, after each save of it, which bytes it wrote
 * (`record_saved`), and the parent raises the last of those bytes once the child has both exited and
 * disconnected — when no report can still be on its way.
 */

import { decorateSessionStore } from '@robota-sdk/agent-framework';

import { isSubagentWorkerChildMessage } from './child-process-subagent-ipc.js';

import type {
  ISubagentWorkerRecordSavedMessage,
  TSubagentWorkerWireValue,
} from './child-process-subagent-ipc.js';
import type { TResumeSessionStore } from './worker-composition.js';
import type { ChildProcess } from 'node:child_process';

/** What the reporting view of a child's store has seen of its fork record. */
export interface IRecordSaveReporter {
  /** The store the child's session saves through: every save of the fork record is reported. */
  readonly store: TResumeSessionStore;
  /** Whether a save of the fork record was refused because its file changed under the child. */
  readonly refused: () => boolean;
  /**
   * The session was restored from the record: from now on a writer's read that finds the file changed
   * is a refused save. Before it, such a read is the restore's own, which fails the job by itself.
   */
  readonly restored: () => void;
}

/** A read that says the file is no longer the bytes the store holds for a session it runs. */
function isChangedOutcome(outcome: ReturnType<TResumeSessionStore['load']> | undefined): boolean {
  return outcome?.status === 'locked' && outcome.reason === 'changed';
}

function isChangedRefusal(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const refusal = error as { readonly code?: unknown; readonly reason?: unknown };
  return refusal.code === 'SESSION_SEALED_UNREADABLE' && refusal.reason === 'changed';
}

/**
 * `store`, seen by a child handed a record: after each save of session `sessionId` the bytes the
 * store now holds are reported through `send`, and a writer's read or a save that found the file
 * changed under it is remembered as a refused save. Every other member is the store's own. A store
 * that holds nothing for the id reports nothing, so the parent vouches for nothing.
 */
export function reportRecordSaves(
  store: TResumeSessionStore,
  sessionId: string,
  send: (message: ISubagentWorkerRecordSavedMessage) => void,
): IRecordSaveReporter {
  let restored = false;
  let refused = false;
  const changedRead = (outcome: ReturnType<TResumeSessionStore['load']> | undefined): void => {
    if (restored && isChangedOutcome(outcome)) refused = true;
  };
  const view = decorateSessionStore(store, {
    save(record, options) {
      try {
        if (options === undefined) store.save(record);
        else store.save(record, options);
      } catch (error) {
        if (record.id === sessionId && isChangedRefusal(error)) refused = true;
        throw error;
      }
      if (record.id !== sessionId) return;
      const sha256 = store.authorship?.heldDigest(sessionId);
      if (sha256 !== undefined) send({ type: 'record_saved', sessionId, sha256 });
    },
    load(id, options) {
      const outcome = options === undefined ? store.load(id) : store.load(id, options);
      if (id === sessionId && options?.hold === true) changedRead(outcome);
      return outcome;
    },
    ...(store.loadHeld !== undefined
      ? {
          loadHeld: (id: string) => {
            const outcome = store.loadHeld?.(id);
            if (id === sessionId) changedRead(outcome);
            return outcome;
          },
        }
      : {}),
  });
  return {
    store: view,
    refused: () => refused,
    restored: () => {
      restored = true;
    },
  };
}

/** The parent's store, as far as vouching for a fork record goes. */
export type TCountersignStore = Pick<TResumeSessionStore, 'authorship'>;

/** What the parent decided once its child was gone, for a caller that wants to know. */
export type TCountersignOutcome =
  | ReturnType<NonNullable<TResumeSessionStore['authorship']>['adopt']>
  /** Nothing was raised: the job did not start from the owner's content, or a save was refused. */
  | 'not-vouched';

export interface IForkRecordCountersign {
  /** The fork record the job runs. */
  readonly sessionId: string;
  /** The record the child was handed was the owner's when the parent wrote it for the fork. */
  readonly startedOwner: boolean;
  readonly store: TCountersignStore;
  /** Told what was decided, once. */
  readonly onSettled?: (outcome: TCountersignOutcome) => void;
}

/**
 * The parent's own listener for a fork job's record saves: it keeps the child's last report, and once
 * the child has both exited and disconnected — every message it sent is in, including any sent after
 * its result — it ends the export, so the record may be raised and tagged again, and raises the last
 * reported bytes to the owner's when the job started from the owner's content and no save was
 * refused. Raising is bound to those bytes: a file that changed since raises nothing, and while the
 * keys are locked it is settled at the next unlock. It outlives the job's result, and anything it
 * cannot do raises nothing.
 */
export function followForkRecordSaves(
  child: ChildProcess,
  countersign: IForkRecordCountersign,
): void {
  let last: ISubagentWorkerRecordSavedMessage | undefined;
  let refused = false;
  let exited = false;
  let disconnected = !child.connected;
  let settled = false;
  const onMessage = (message: TSubagentWorkerWireValue): void => {
    // The union's own guard, the strict one: a malformed report fails the job and is never vouched for.
    if (!isSubagentWorkerChildMessage(message)) return;
    if (message.type === 'record_saved') {
      if (message.sessionId === countersign.sessionId) last = message;
      return;
    }
    if ((message.type === 'result' || message.type === 'error') && message.recordSaveRefused) {
      refused = true;
    }
  };
  const settle = (): void => {
    if (settled || !exited || !disconnected) return;
    settled = true;
    child.off('message', onMessage);
    let outcome: TCountersignOutcome = 'not-vouched';
    try {
      if (countersign.startedOwner && last !== undefined && !refused) {
        outcome =
          countersign.store.authorship?.adopt(countersign.sessionId, last.sha256) ?? 'changed';
      }
    } catch {
      // allow-fallback: a record the parent could not vouch for stays unverified and prompts on resume.
      outcome = 'changed';
    }
    countersign.onSettled?.(outcome);
  };
  child.on('message', onMessage);
  child.once('exit', () => {
    exited = true;
    settle();
  });
  child.once('disconnect', () => {
    disconnected = true;
    settle();
  });
  // A child that never started emits `error` and neither of the two: nothing can come from it.
  child.once('error', () => {
    if (child.pid !== undefined) return;
    exited = true;
    disconnected = true;
    settle();
  });
}
