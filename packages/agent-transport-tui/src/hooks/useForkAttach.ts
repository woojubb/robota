/**
 * CLI-1994: the App's `attach` handler, as a hook rather than another closure inside `App.tsx`.
 *
 * `App.tsx` is a file the size floor has already frozen as debt, where the rule is "split instead of
 * extending" — so the handler lives beside the other App hooks. The decision itself is neither here
 * nor there: `attachToForkedSession` asks the framework, which owns when `attach` is offered and
 * when it is honoured.
 */

import { createSystemMessage, messageToHistoryEntry } from '@robota-sdk/agent-core';
import { useCallback } from 'react';

import { attachToForkedSession } from '../flows/fork-attach-flow.js';

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

/**
 * Attach to a forked conversation: point this terminal at the fork's own session record. A VIEW
 * switch, never a merge — the parent's record is not read, written or joined either way.
 */
export function useForkAttach({
  sessionStore,
  onSessionSwitch,
  addEntry,
}: IUseForkAttachOptions): (entry: IExecutionWorkspaceEntry) => void {
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
      attachToForkedSession(entry, {
        hasSessionRecord: (sessionId) => sessionStore.load(sessionId).status === 'valid',
        switchSession: onSessionSwitch,
        notify,
      });
    },
    [addEntry, onSessionSwitch, sessionStore],
  );
}
