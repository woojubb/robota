/** The picker asks one surface-bound decision port before it switches or requests acceptance. */
import { createSystemMessage, messageToHistoryEntry } from '@robota-sdk/agent-core';
import { UNVERIFIED_SESSION_QUESTION, unverifiedSessionNotice } from '@robota-sdk/agent-framework';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { IAppSessionAcceptanceViewModel } from '../app-view-model.js';
import type { TSessionSwitch } from '../types.js';
import type { IHistoryEntry } from '@robota-sdk/agent-core';
import type { IOwnerSessionDirectory } from '@robota-sdk/agent-interface/session';

export const RESUME_CANCELLED_NOTICE = 'Session resume cancelled.';
const OWNER_REFUSAL = 'The session could not be resumed.';

export interface IUseSessionSelectionOptions {
  /** An adapter that validates ids and supplies only fixed, safe refusal text. */
  readonly ownerSessions: IOwnerSessionDirectory;
  readonly onOwnerInvalidated?: ((listener: () => void) => () => void) | undefined;
  readonly pickerVisible: boolean;
  readonly setPickerVisible: (visible: boolean) => void;
  readonly onSessionSwitch: TSessionSwitch;
  readonly addEntry: (entry: IHistoryEntry) => void;
}

export interface ISessionSelection {
  readonly select: (sessionId: string) => void;
  readonly cancel: () => void;
  readonly pickerKey: number;
  readonly pendingAcceptance: IAppSessionAcceptanceViewModel | undefined;
}

interface IPendingAcceptance {
  readonly sessionId: string;
  readonly digest: string;
  readonly questionId: string;
  readonly generation: number;
  readonly owner: IOwnerSessionDirectory;
}

export function useSessionSelection(options: IUseSessionSelectionOptions): ISessionSelection {
  const { pickerVisible, setPickerVisible, onSessionSwitch, addEntry, ownerSessions, onOwnerInvalidated } = options;
  const [pending, setPending] = useState<IPendingAcceptance | undefined>();
  const [pickerKey, setPickerKey] = useState(0);
  const generation = useRef(0);
  const ownerQuestionActive = useRef<IOwnerSessionDirectory | undefined>(undefined);
  const renderedOwner = useRef(ownerSessions);
  // A stale callback cannot use a decision from a different store or connection, even before the
  // old effect's cleanup sends its cancellation.
  if (renderedOwner.current !== ownerSessions) {
    renderedOwner.current = ownerSessions;
    generation.current += 1;
  }
  const say = useCallback(
    (content: string) => addEntry(messageToHistoryEntry(createSystemMessage(content))),
    [addEntry],
  );
  const cancelOwnerQuestion = useCallback(() => {
    if (ownerQuestionActive.current !== ownerSessions) return;
    ownerQuestionActive.current = undefined;
    try {
      void Promise.resolve(ownerSessions.cancelQuestion()).catch(() => undefined);
    } catch {
      // The linked adapter closes its owner connection if cancellation fails.
    }
  }, [ownerSessions]);
  useEffect(() => {
    if (!pickerVisible) {
      generation.current += 1;
      cancelOwnerQuestion();
      setPending(undefined);
    }
  }, [pickerVisible, cancelOwnerQuestion]);
  useEffect(() => () => { generation.current += 1; cancelOwnerQuestion(); }, [cancelOwnerQuestion]);
  useEffect(() => onOwnerInvalidated?.(() => {
    generation.current += 1;
    if (ownerQuestionActive.current === ownerSessions) ownerQuestionActive.current = undefined;
    setPending(undefined);
    setPickerVisible(false);
  }), [onOwnerInvalidated, ownerSessions, setPickerVisible]);

  const cancel = useCallback(() => {
    generation.current += 1;
    cancelOwnerQuestion();
    setPending(undefined);
    setPickerVisible(false);
    say(RESUME_CANCELLED_NOTICE);
  }, [cancelOwnerQuestion, setPickerVisible, say]);

  const select = useCallback((sessionId: string) => {
    const current = ++generation.current;
    cancelOwnerQuestion();
    setPending(undefined);
    // A list resolves Enter; remount it while the question is in flight so the person can cancel
    // or choose a different row without waiting for the host's answer.
    setPickerKey((key) => key + 1);
    ownerQuestionActive.current = ownerSessions;
    // Requests on a linked adapter are written immediately in selection order. The runtime applies
    // question and cancel state changes synchronously in stream order, independent of their replies.
    try {
      void Promise.resolve(ownerSessions.question(sessionId)).then((result) => {
        if (generation.current !== current || renderedOwner.current !== ownerSessions) return;
        if (result.kind === 'accept') {
          setPending({ sessionId, digest: result.digest, questionId: result.questionId, generation: current, owner: ownerSessions });
        } else {
          ownerQuestionActive.current = undefined;
          setPickerVisible(false);
          if (result.kind === 'open') void onSessionSwitch(sessionId);
          else say(result.message);
        }
      }).catch(() => {
        if (generation.current !== current || renderedOwner.current !== ownerSessions) return;
        cancelOwnerQuestion();
        setPickerVisible(false);
        say(OWNER_REFUSAL);
      });
    } catch {
      cancelOwnerQuestion();
      setPickerVisible(false);
      say(OWNER_REFUSAL);
    }
  }, [ownerSessions, cancelOwnerQuestion, setPickerVisible, onSessionSwitch, say]);

  const answer = useCallback((accepted: boolean) => {
    if (pending === undefined || generation.current !== pending.generation ||
        renderedOwner.current !== pending.owner) return;
    generation.current += 1;
    setPending(undefined);
    setPickerVisible(false);
    if (!accepted) {
      cancelOwnerQuestion();
      say(RESUME_CANCELLED_NOTICE);
      return;
    }
    ownerQuestionActive.current = undefined;
    try {
      void Promise.resolve(pending.owner.openAccepted(pending.sessionId, pending.digest, pending.questionId))
        .catch(() => say(OWNER_REFUSAL));
    } catch {
      say(OWNER_REFUSAL);
    }
  }, [pending, cancelOwnerQuestion, setPickerVisible, say]);

  const pendingAcceptance = useMemo(
    () => pickerVisible && pending !== undefined && pending.owner === ownerSessions
      ? { message: `${unverifiedSessionNotice(pending.sessionId)}\n${UNVERIFIED_SESSION_QUESTION}`, answer }
      : undefined,
    [pickerVisible, pending, ownerSessions, answer],
  );
  return { select, cancel, pickerKey, pendingAcceptance };
}
