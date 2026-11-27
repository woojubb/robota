/**
 * How forgetting a fact in the library reaches the conversations that copied it.
 *
 * A wiki search or read puts a statement word for word into the conversation that asked, and a
 * resumed chat sends its whole record back to the model, so a fact left in a saved conversation comes
 * back after the library forgot it. When the wiki has removed a statement it hands the text here, and
 * this module replaces it with the forgotten marker in every conversation record of both stores (the
 * chats and messenger conversations, and the goal runs) and in the titles of side chats.
 *
 * - Every message, id, timestamp and tool-call pairing stays, so a cleaned record still resumes; only
 *   the matched span changes, and a record that holds no match is not written.
 * - A record another writer holds, one that waits on an execution a journal would replay, and one
 *   that cannot be read are never written to: they are counted as not reached.
 * - A session this process runs is cleaned in memory and saved when it is idle. A busy one owes the
 *   cleaning: its saves are cleaned meanwhile (see `owed-redactions.ts`) and it is cleaned when its
 *   turn ends.
 * - Reaches run one at a time in this process and, through a lock in the state directory, across
 *   agents; a failed reach is the wiki's to report and never undoes the forget.
 */
import { realpathSync } from 'node:fs';
import { join } from 'node:path';

import { persistSessionRedaction, redactSessionRecord } from '@robota-sdk/agent-framework';
import { createForgottenTextRedactor, isSpecificText } from '@robota-sdk/agent-product/personal';

import { createOwedRedactions } from './owed-redactions.js';
import { createSharedLock } from './shared-lock.js';
import { createPersonalGoalSessionStore, createPersonalSessionStore } from './session-stores.js';

import type { IInteractiveSessionStore, TTextRedactor } from '@robota-sdk/agent-framework';
import type {
  IForgetReach,
  IForgetReachReport,
  IForgottenText,
} from '@robota-sdk/agent-product/personal';
import type { IOwedRedactions } from './owed-redactions.js';
import type { ISideChatBook } from './side-chats.js';

/** The part of a running session a forget needs. */
export interface ILiveConversation {
  readonly sessionId: string;
  getName(): string | undefined;
  /** `busy` while a turn, a prompt or a parked execution is in progress; nothing is changed then. */
  redactConversation(redact: TTextRedactor): 'redacted' | 'unchanged' | 'busy';
  on(event: 'complete' | 'interrupted' | 'error', handler: () => void): void;
  off(event: 'complete' | 'interrupted' | 'error', handler: () => void): void;
}

/** What the running process holds: the sessions it runs, and what their saves owe. */
export interface IHeldConversations {
  live(): readonly ILiveConversation[];
  readonly owed: IOwedRedactions;
}

export interface IConversationForgetting {
  readonly reach: IForgetReach;
  /** Connect the running agent's sessions; before this only saved records are reached. */
  bind(held: IHeldConversations): void;
  /** Stop waiting for busy sessions: their saves stay cleaned until the process ends. */
  dispose(): void;
}

export interface IConversationForgettingOptions {
  readonly stateDir: string;
  readonly sideChats: ISideChatBook;
}

/** How often a busy session is tried again, besides each time one of its turns ends. */
const RETRY_MS = 200;
const TURN_END = ['complete', 'interrupted', 'error'] as const;

/**
 * What a forget leaves in place, in words the person reads. Kept beside the code that decides what is
 * searched, so the answer cannot claim more than the search does.
 */
export const FORGET_STAYS: readonly string[] = [
  'Only the exact words of the forgotten statement are searched for: the same thing said differently, a paraphrase, or part of it stays.',
  'Places named in a conversation (file paths, addresses, folders), message names, and a conversation’s goal, plan, background tasks and loops are not searched.',
  'What a service or another person sent you, and what the agent read from it, stays.',
  'The feed, its run history and the cases are not changed.',
  'A conversation another running agent holds is not changed until that agent stops.',
  'Anything already sent to the model provider or to a messaging channel stays with them.',
  'Backups of this folder keep their copy.',
];

interface IBusySession {
  readonly session: ILiveConversation;
  readonly texts: Set<string>;
  timer: ReturnType<typeof setInterval> | undefined;
  readonly trigger: () => void;
}

function serialize(): <T>(work: () => Promise<T>) => Promise<T> {
  let tail: Promise<unknown> = Promise.resolve();
  return (work) => {
    const run = tail.then(work, work);
    tail = run.catch(() => undefined);
    return run;
  };
}

export function createConversationForgetting(
  options: IConversationForgettingOptions,
): IConversationForgetting {
  // Records are read and written through stores of this module's own: a session this process runs
  // holds its id through the store it was built from, so a record it holds reads as held here.
  const chats = createPersonalSessionStore(options.stateDir);
  const goals = createPersonalGoalSessionStore(options.stateDir);
  const exclusive = serialize();
  const acrossAgents = createSharedLock(
    join(realpathSync(options.stateDir), '.forget-reach.lock'),
    'Forgetting',
  );
  let held: IHeldConversations = { live: () => [], owed: createOwedRedactions() };
  const busy = new Map<string, IBusySession>();

  const settle = (id: string): void => {
    const entry = busy.get(id);
    if (entry === undefined) return;
    clearInterval(entry.timer);
    for (const event of TURN_END) entry.session.off(event, entry.trigger);
    busy.delete(id);
    held.owed.settle(id);
  };

  const attempt = (id: string): void => {
    const entry = busy.get(id);
    if (entry === undefined) return;
    try {
      if (
        entry.session.redactConversation(createForgottenTextRedactor([...entry.texts])) !== 'busy'
      )
        settle(id);
    } catch {
      // allow-fallback: a session that has ended cannot be cleaned in memory; its last saves were
      // cleaned on the way to disk, and the debt is dropped with it.
      settle(id);
    }
  };

  const owe = (session: ILiveConversation, texts: readonly string[]): void => {
    const id = session.sessionId;
    let entry = busy.get(id);
    if (entry === undefined) {
      const created: IBusySession = {
        session,
        texts: new Set<string>(),
        timer: undefined,
        trigger: () => {
          // The event comes before the turn is over: look again once the turn has been wound up.
          setTimeout(() => attempt(id), 0).unref();
        },
      };
      created.timer = setInterval(() => attempt(id), RETRY_MS);
      created.timer.unref();
      for (const event of TURN_END) session.on(event, created.trigger);
      busy.set(id, created);
      entry = created;
    }
    for (const text of texts) entry.texts.add(text);
    held.owed.owe(id, texts);
  };

  async function reachNow(forgotten: readonly IForgottenText[]): Promise<IForgetReachReport> {
    // A statement is searched in every conversation when it is distinctive; a short one ("tea") would
    // damage unrelated text, so it is searched only in the conversation it was learned in. A page
    // title is ordinary words unless it is long enough to be distinctive.
    const everywhere = new Set<string>();
    const sourced = new Map<string, Set<string>>();
    for (const item of forgotten) {
      const text = item.text.trim();
      if (text === '') continue;
      if (isSpecificText(text)) everywhere.add(text);
      else if (item.kind === 'claim' && item.sessionId !== undefined) {
        const own = sourced.get(item.sessionId) ?? new Set<string>();
        own.add(text);
        sourced.set(item.sessionId, own);
      }
    }
    const textsFor = (id: string): string[] => [...everywhere, ...(sourced.get(id) ?? [])];
    const redactorFor = (id: string): TTextRedactor | undefined => {
      const texts = textsFor(id);
      return texts.length === 0 ? undefined : createForgottenTextRedactor(texts);
    };
    const sourceIds = new Set<string>();
    for (const item of forgotten) {
      if (item.kind === 'claim' && item.sessionId !== undefined) sourceIds.add(item.sessionId);
    }

    const cleaned = new Set<string>();
    const pending = new Set<string>();
    const notReached = new Set<string>();
    /** The conversations the removed claims were learned in that still exist, with their names. */
    const names = new Map<string, string | undefined>();
    const liveIds = new Set<string>();

    for (const session of held.live()) {
      const id = session.sessionId;
      if (id === '') continue;
      try {
        if (sourceIds.has(id)) names.set(id, session.getName());
        const redact = redactorFor(id);
        const outcome = redact === undefined ? 'unchanged' : session.redactConversation(redact);
        liveIds.add(id);
        if (outcome === 'redacted') cleaned.add(id);
        else if (outcome === 'busy') {
          owe(session, textsFor(id));
          pending.add(id);
        }
      } catch {
        // allow-fallback: a session that has ended is a saved record now, and is read as one below.
        names.delete(id);
      }
    }

    const reachStore = async (store: IInteractiveSessionStore): Promise<void> => {
      for (const entry of store.list()) {
        const id = entry.id;
        const outcome = entry.outcome;
        if (outcome.status === 'valid' && sourceIds.has(id) && !names.has(id))
          names.set(id, outcome.record.name);
        if (liveIds.has(id) || outcome.status === 'missing') continue;
        const redact = redactorFor(id);
        if (redact === undefined) continue;
        if (outcome.status !== 'valid') {
          // Nothing can be read from it, so nothing shows that it holds no copy.
          notReached.add(id);
          continue;
        }
        if (redactSessionRecord(outcome.record, redact) === undefined) continue;
        const { status } = await persistSessionRedaction(store, id, redact);
        if (status === 'redacted') cleaned.add(id);
        else if (status !== 'unchanged' && status !== 'missing') notReached.add(id);
      }
    };
    await reachStore(chats);
    await reachStore(goals);

    for (const id of options.sideChats.redactTitles(redactorFor)) cleaned.add(id);

    // A record counts once, as the least reached state it was found in.
    const unreached = notReached.size;
    const waiting = [...pending].filter((id) => !notReached.has(id));
    const done = [...cleaned].filter((id) => !notReached.has(id) && !pending.has(id));
    const sources: string[] = [];
    for (const id of sourceIds) {
      if (!names.has(id)) continue;
      const name = names.get(id)?.trim();
      // The name is cleaned like any other text: the conversation may have been named after the fact.
      const shown = name === undefined || name === '' ? `chat ${id.slice(0, 8)}` : name;
      sources.push(redactorFor(id)?.(shown) ?? shown);
    }
    return {
      cleaned: done.length,
      pending: waiting.length,
      notReached: unreached,
      sources: [...new Set(sources)],
    };
  }

  return {
    reach: {
      reach: (forgotten) => exclusive(() => acrossAgents(() => reachNow(forgotten))),
    },
    bind(next) {
      held = next;
    },
    dispose() {
      for (const id of [...busy.keys()]) {
        const entry = busy.get(id);
        if (entry === undefined) continue;
        clearInterval(entry.timer);
        for (const event of TURN_END) entry.session.off(event, entry.trigger);
        busy.delete(id);
      }
    },
  };
}
