/**
 * CLI-1994: the App's `attach` handler, as a hook rather than another closure inside `App.tsx`.
 *
 * `App.tsx` is a file the size floor has already frozen as debt, where the rule is "split instead of
 * extending" — so the handler lives beside the other App hooks. The decision itself is neither here
 * nor there: `attachToForkedSession` asks the framework, which owns when `attach` is offered and
 * when it is honoured.
 *
 * #3679 3f: the person pressing attach on a fork sealed while the keys are locked is a read they
 * started, so this handler — one of the UI action modules the mint admits — asks the keys' holder to
 * unlock for it (`continue-fork`) and attaches once that opens the record.
 */

import { createSystemMessage, messageToHistoryEntry } from '@robota-sdk/agent-core';
import { lockedSessionMessage, lockedSessionReason } from '@robota-sdk/agent-framework';
import { useCallback } from 'react';

import { attachToForkedSession } from '../flows/fork-attach-flow.js';
import { mintUserReadRequest } from '../key-custody/user-read-request-mint.js';
import { useTuiCliAdapter } from '../tui-cli-adapter-context.js';

import type { TReadability } from '../key-custody/key-custody-port.js';
import type { IHistoryEntry } from '@robota-sdk/agent-core';
import type { IExecutionWorkspaceEntry } from '@robota-sdk/agent-interface-execution';
import type { IInteractiveSessionStore } from '@robota-sdk/agent-interface-session';

export interface IUseForkAttachOptions {
  /** Absent when the surface persists nothing; attach then refuses, saying so. */
  readonly sessionStore: IInteractiveSessionStore | undefined;
  /** The surface's session-switch path — the same one the session picker takes. */
  readonly onSessionSwitch: (sessionId: string) => void;
  /** Where a refusal is written, so it reaches the operator instead of disappearing. */
  readonly addEntry: (entry: IHistoryEntry) => void;
}

/** What is said when the person did not unlock: the fixed lock wording, then where to unlock. */
function stillLocked(sessionId: string, readability: Exclude<TReadability, 'readable'>): string {
  const why =
    readability === 'declined'
      ? 'It was not unlocked'
      : 'The passphrase could not be asked for here';
  return `Session ${sessionId} is sealed and locked. ${why}; run \`/unlock\` at this terminal, then attach again.`;
}

/**
 * Attach to a forked conversation: point this terminal at the fork's own session record. A VIEW
 * switch, never a merge — the parent's record is not read, written or joined either way.
 */
export function useForkAttach({
  sessionStore,
  onSessionSwitch,
  addEntry,
}: IUseForkAttachOptions): (entry: IExecutionWorkspaceEntry) => void {
  const cliAdapter = useTuiCliAdapter();
  return useCallback(
    (entry: IExecutionWorkspaceEntry): void => {
      const notify = (message: string): void =>
        addEntry(messageToHistoryEntry(createSystemMessage(message)));
      // A surface composed without a session store cannot open another session's record. Said
      // plainly rather than reported as "the record is missing", which is a different fact.
      if (sessionStore === undefined) {
        notify('This surface has no session store, so it cannot attach to a forked session.');
        return;
      }
      const attach = (): void => {
        attachToForkedSession(entry, {
          hasSessionRecord: (sessionId) => sessionStore.load(sessionId).status === 'valid',
          hasWriter: (sessionId) => sessionStore.hasWriter(sessionId),
          switchSession: onSessionSwitch,
          notify,
          ...(cliAdapter.formatResumeCommand === undefined
            ? {}
            : { formatResumeCommand: cliAdapter.formatResumeCommand }),
        });
      };
      // A fork written sealed whose keys have locked since is present, not gone; "no longer in the
      // session store" would be the wrong thing to tell the operator.
      const sessionId = entry.resumeSessionId;
      const lockedReason =
        sessionId === undefined ? undefined : lockedSessionReason(sessionStore, sessionId);
      if (sessionId === undefined || lockedReason === undefined) {
        attach();
        return;
      }
      // Only locked keys are something an unlock opens; keys this process does not have are not.
      const keys = cliAdapter.keyCustody;
      if (lockedReason !== 'locked' || keys === undefined) {
        notify(lockedSessionMessage(sessionId, lockedReason));
        return;
      }
      void keys.ensureReadable(mintUserReadRequest('continue-fork')).then(
        (readability) => {
          if (readability !== 'readable') {
            notify(stillLocked(sessionId, readability));
            return;
          }
          // Read again: what the unlock opened decides, not what was true before it.
          const reason = lockedSessionReason(sessionStore, sessionId);
          if (reason === undefined) attach();
          else notify(lockedSessionMessage(sessionId, reason));
        },
        // allow-fallback: a holder that failed to ask leaves the fork locked, which is said.
        () => notify(stillLocked(sessionId, 'unavailable')),
      );
    },
    [addEntry, cliAdapter, onSessionSwitch, sessionStore],
  );
}
