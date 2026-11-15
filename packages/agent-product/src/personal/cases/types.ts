/**
 * Cases: a thread of thought the agent opens from something it noticed, asks the person about, and
 * keeps until it is settled. A case is not a chat and not a goal: it is the agent's own record of one
 * matter (what it saw, what it noted, the one question it is waiting on, and what happened), kept
 * beside the goals and the feed the question is shown in.
 */

export type TCaseState = 'open' | 'closed';
export type TCaseEventKind = 'observed' | 'noted' | 'asked' | 'answered' | 'closed';

/** Where a case came from: the service that showed it and the agent's own stable reference to the item. */
export interface ICaseOrigin {
  readonly connectorId?: string;
  /** The same reference for the same item every time, so one source never opens two cases. */
  readonly source: string;
}

export interface ICaseNote {
  readonly at: string;
  readonly text: string;
}

/** The question a case is waiting on; at most one at a time. */
export interface ICaseQuestion {
  readonly text: string;
  /** The answers the person may pick; empty when only a reply is wanted. */
  readonly options: readonly string[];
  readonly allowsReply: boolean;
  readonly askedAt: string;
  /** The feed item that shows the question to the person. */
  readonly feedItemId: string;
}

/** What happened on the case, oldest first. */
export interface ICaseEvent {
  readonly at: string;
  readonly kind: TCaseEventKind;
  readonly text: string;
}

export interface ICase {
  readonly id: string;
  readonly title: string;
  readonly origin: ICaseOrigin;
  readonly state: TCaseState;
  /** The agent's running notes, oldest first; what a question shows as its evidence. */
  readonly notes: readonly ICaseNote[];
  readonly question?: ICaseQuestion;
  readonly history: readonly ICaseEvent[];
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** Where cases live; a host supplies one per principal. */
export interface ICaseStore {
  list(): Promise<readonly ICase[]>;
  get(id: string): Promise<ICase | undefined>;
  put(item: ICase): Promise<void>;
}
