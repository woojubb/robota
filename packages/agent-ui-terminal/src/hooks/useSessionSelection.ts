/**
 * What picking a session in the resume picker does, over a store that seals.
 *
 * A record that opens says nothing about who wrote it, so a picked record the store cannot show to be
 * the person's own is not resumed on the pick. The person is told so in fixed text (never anything the
 * record says) and asked whether it is theirs; a yes switches with the digest of exactly the bytes they
 * were asked about, and the session that opens the record resumes only those and raises them to the
 * person's once it has restored from them. A store that never seals lists no unverified record, so
 * every pick there switches at once.
 */

import { createSystemMessage, messageToHistoryEntry } from '@robota-sdk/agent-core';
import {
  unacceptableSessionMessage,
  UNVERIFIED_SESSION_QUESTION,
  unverifiedSessionNotice,
} from '@robota-sdk/agent-framework';
import { useCallback, useEffect, useMemo, useState } from 'react';

import type { IAppSessionAcceptanceViewModel } from '../app-view-model.js';
import type { TSessionSwitch } from '../types.js';
import type { IHistoryEntry } from '@robota-sdk/agent-core';
import type {
  IInteractiveSessionStore,
  ISessionListingEntry,
} from '@robota-sdk/agent-interface-session';

/** Said when a pick ends without a session being resumed: cancelled in the list, or answered no. */
export const RESUME_CANCELLED_NOTICE = 'Session resume cancelled.';

export interface IUseSessionSelectionOptions {
  readonly sessions: readonly ISessionListingEntry[];
  readonly sessionStore: IInteractiveSessionStore | undefined;
  /** The listing is a host's, not read from `sessionStore`: the host's session judges its own records. */
  readonly hostListing: boolean;
  readonly pickerVisible: boolean;
  readonly setPickerVisible: (visible: boolean) => void;
  readonly onSessionSwitch: TSessionSwitch;
  readonly addEntry: (entry: IHistoryEntry) => void;
}

export interface ISessionSelection {
  readonly select: (sessionId: string) => void;
  readonly pendingAcceptance: IAppSessionAcceptanceViewModel | undefined;
}

interface IPendingAcceptance {
  readonly sessionId: string;
  /** The SHA-256 of the stored bytes the person is asked about, which the probe read. */
  readonly digest: string;
}

export function useSessionSelection(options: IUseSessionSelectionOptions): ISessionSelection {
  const { sessions, sessionStore, hostListing, pickerVisible, setPickerVisible } = options;
  const { onSessionSwitch, addEntry } = options;
  const [pending, setPending] = useState<IPendingAcceptance | undefined>();
  const say = useCallback(
    (content: string) => addEntry(messageToHistoryEntry(createSystemMessage(content))),
    [addEntry],
  );
  // A question left open when the picker goes away is not asked again the next time it opens.
  useEffect(() => {
    if (!pickerVisible) setPending(undefined);
  }, [pickerVisible]);

  const select = useCallback(
    (sessionId: string) => {
      const listedAuthorship = sessions.find((entry) => entry.id === sessionId)?.authorship;
      if (listedAuthorship === 'unverified' && !hostListing && sessionStore !== undefined) {
        // A plain read, taken now rather than trusted from the listing: it names the bytes the
        // person will be asked about, and if the record is no longer unverified there is nothing to ask.
        const probe = sessionStore.load(sessionId);
        if (probe.status === 'valid' && probe.authorship === 'unverified') {
          if (probe.digest === undefined) {
            setPickerVisible(false);
            say(unacceptableSessionMessage(sessionId));
          } else {
            setPending({ sessionId, digest: probe.digest });
          }
          return;
        }
      }
      setPickerVisible(false);
      void onSessionSwitch(sessionId);
    },
    [sessions, hostListing, sessionStore, setPickerVisible, say, onSessionSwitch],
  );

  const answer = useCallback(
    (accepted: boolean) => {
      if (pending === undefined) return;
      setPending(undefined);
      setPickerVisible(false);
      if (!accepted) {
        say(RESUME_CANCELLED_NOTICE);
        return;
      }
      void onSessionSwitch(pending.sessionId, { acceptedDigest: pending.digest });
    },
    [pending, setPickerVisible, say, onSessionSwitch],
  );

  const pendingAcceptance = useMemo(
    () =>
      pickerVisible && pending !== undefined
        ? {
            message: `${unverifiedSessionNotice(pending.sessionId)}\n${UNVERIFIED_SESSION_QUESTION}`,
            answer,
          }
        : undefined,
    [pickerVisible, pending, answer],
  );
  return { select, pendingAcceptance };
}
