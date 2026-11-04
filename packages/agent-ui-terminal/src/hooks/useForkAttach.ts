/**
 * CLI-1994: the App's `attach` handler, as a hook rather than another closure inside `App.tsx`.
 *
 * `App.tsx` is a file the size floor has already frozen as debt, where the rule is "split instead of
 * extending" — so the handler lives beside the other App hooks. The decision itself is neither here
 * nor there: `attachToForkedSession` asks the framework, which owns when `attach` is offered and
 * what it does.
 *
 * #3679 3f: attaching to a job that is still running FOLLOWS it — the entry is selected, nothing
 * else — so it reads no record: it needs no session store and asks for no passphrase, locked or not.
 * Continuing a fork that has ended is the ordinary switch: the person pressing attach on a fork
 * sealed while the keys are locked is a read they started, so this handler — one of the UI action
 * modules the mint admits — asks the keys' holder to unlock for it (`continue-fork`) and switches
 * once that opens the record.
 */

import { createSystemMessage, messageToHistoryEntry } from '@robota-sdk/agent-core';
import { attachKind, lockedSessionMessage, lockedSessionReason } from '@robota-sdk/agent-framework';
import { useCallback } from 'react';

import { attachToForkedSession } from '../flows/fork-attach-flow.js';
import { mintUserReadRequest } from '../key-custody/user-read-request-mint.js';
import { useTuiCliAdapter, useUnlockCommand } from '../tui-cli-adapter-context.js';

import type { TReadability } from '../key-custody/key-custody-port.js';
import type { IHistoryEntry } from '@robota-sdk/agent-core';
import type { IExecutionWorkspaceEntry } from '@robota-sdk/agent-interface-execution';
import type { IInteractiveSessionStore } from '@robota-sdk/agent-interface-session';

export interface IUseForkAttachOptions {
  /**
   * Absent when this terminal is attached to a host's session or persists nothing: it then asks the
   * host to switch, and the host's refusal is what continuing a fork is told.
   */
  readonly sessionStore: IInteractiveSessionStore | undefined;
  /** The surface's session-switch path — the same one the session picker takes. */
  readonly onSessionSwitch: (sessionId: string) => void;
  /** Selects a workspace entry: the view a followed job is watched, and steered, in. */
  readonly select: (entryId: string) => void;
  /** Where a refusal is written, so it reaches the operator instead of disappearing. */
  readonly addEntry: (entry: IHistoryEntry) => void;
}

/** What is said when the person did not unlock: the fixed lock wording, then where to unlock. */
function stillLocked(
  sessionId: string,
  readability: Exclude<TReadability, 'readable'>,
  unlockCommand: string,
): string {
  const why =
    readability === 'declined'
      ? 'It was not unlocked'
      : 'The passphrase could not be asked for here';
  return `Session ${sessionId} is sealed and locked. ${why}; run \`${unlockCommand}\` at this terminal, then attach again.`;
}

/**
 * Attach to a fork: follow the job while it runs, or point this terminal at the fork's own session
 * record once it has ended. A VIEW switch, never a merge — the parent's record is not read, written
 * or joined either way.
 */
export function useForkAttach({
  sessionStore,
  onSessionSwitch,
  select,
  addEntry,
}: IUseForkAttachOptions): (entry: IExecutionWorkspaceEntry) => void {
  const cliAdapter = useTuiCliAdapter();
  const unlockCommand = useUnlockCommand();
  return useCallback(
    (entry: IExecutionWorkspaceEntry): void => {
      const notify = (message: string): void =>
        addEntry(messageToHistoryEntry(createSystemMessage(message)));
      const resume = {
        followTask: (followed: IExecutionWorkspaceEntry) => select(followed.id),
        notify,
        ...(cliAdapter.formatResumeCommand === undefined
          ? {}
          : { formatResumeCommand: cliAdapter.formatResumeCommand }),
      };
      // Following reads no record, so it needs no store and no unlock; a surface with no store hands a
      // continue to its host, whose switch refuses a record that cannot be opened in its own words.
      if (attachKind(entry) !== 'continue' || sessionStore === undefined) {
        attachToForkedSession(entry, {
          ...resume,
          facts: { kind: 'host' },
          switchSession: onSessionSwitch,
        });
        return;
      }
      // A fork written sealed whose keys have locked since is present, not gone; "no longer in the
      // session store" would be the wrong thing to tell the operator.
      const sessionId = entry.resumeSessionId;
      const lockedReason =
        sessionId === undefined ? undefined : lockedSessionReason(sessionStore, sessionId);
      // Only locked keys are something an unlock opens; keys this process does not have are not.
      const keys = cliAdapter.keyCustody;
      if (sessionId !== undefined && lockedReason !== undefined) {
        if (lockedReason !== 'locked' || keys === undefined) {
          notify(lockedSessionMessage(sessionId, lockedReason));
          return;
        }
      }
      // The passphrase is asked for on the switch itself, so only an attach the framework would
      // honour asks: a fork whose record still has a writer is refused without a prompt.
      const unlockThenSwitch = (target: string): void => {
        if (keys === undefined || unlockCommand === undefined || lockedReason === undefined) {
          onSessionSwitch(target);
          return;
        }
        void keys.ensureReadable(mintUserReadRequest('continue-fork')).then(
          (readability) => {
            if (readability !== 'readable') {
              notify(stillLocked(target, readability, unlockCommand));
              return;
            }
            // Read again: what the unlock opened decides, not what was true before it.
            const reason = lockedSessionReason(sessionStore, target);
            if (reason === undefined) onSessionSwitch(target);
            else notify(lockedSessionMessage(target, reason, unlockCommand));
          },
          // allow-fallback: a holder that failed to ask leaves the fork locked, which is said.
          () => notify(stillLocked(target, 'unavailable', unlockCommand)),
        );
      };
      attachToForkedSession(entry, {
        ...resume,
        facts: {
          kind: 'store',
          // A record the unlock can open is there; the switch asks for it.
          hasSessionRecord: (target) =>
            (target === sessionId && lockedReason === 'locked') ||
            sessionStore.load(target).status === 'valid',
          hasWriter: (target) => sessionStore.hasWriter(target),
        },
        switchSession: unlockThenSwitch,
      });
    },
    [addEntry, cliAdapter, onSessionSwitch, select, sessionStore, unlockCommand],
  );
}
