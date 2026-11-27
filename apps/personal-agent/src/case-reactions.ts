/**
 * How the questions the agent asks about its cases are answered, by the kind of service each case came
 * from. One record per asked question holds only identifiers, a kind and times: never the question, the
 * answer or anything from the source. The feed card is the one record of an answer, so a record is
 * settled from the card, on the delivery tick and on every read. Nothing here changes a limit.
 */
import { mkdirSync, readFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';

import { createSharedLock } from './shared-lock.js';
import { writeAtomically } from './task-catalog/json-records.js';

import type { ICaseAskedEvent, TConnectorKind } from '@robota-sdk/agent-product/personal';

export type TReactionKind = TConnectorKind | 'none';

export interface ICaseReaction {
  readonly feedItemId: string;
  readonly caseId: string;
  readonly kind: TReactionKind;
  readonly askedAt: string;
  readonly answeredAt?: string;
  readonly withdrawnAt?: string;
  readonly dismissedAt?: string;
}

export interface IReactionSummary {
  readonly asked: number;
  readonly answered: number;
  /** Withdrawn without an answer, or still open after the window. */
  readonly unanswered: number;
  readonly open: number;
  readonly dismissed: number;
  readonly medianSecondsToAnswer: number | null;
}

export interface ICaseReactions {
  asked(event: ICaseAskedEvent): Promise<void>;
  reconcile(): Promise<void>;
  summary(): Promise<Readonly<Partial<Record<TReactionKind, IReactionSummary>>>>;
}

/** The card of a question: the one record of how it stands. */
export interface IReactionCard {
  readonly dismissed: boolean;
  readonly question?: {
    readonly state: 'open' | 'answered' | 'withdrawn';
    readonly answer?: { readonly at: string };
  };
}

/** A question still open this long counts as unanswered; cases do not close on their own. */
export const OPEN_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
export const REACTION_LIMIT = 500;

const isSettled = (entry: ICaseReaction): boolean =>
  entry.answeredAt !== undefined ||
  entry.withdrawnAt !== undefined ||
  entry.dismissedAt !== undefined;

function read(path: string): readonly ICaseReaction[] {
  let raw: unknown;
  try {
    raw = (JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>)['reactions'];
  } catch {
    // allow-fallback: a missing or unreadable file starts empty; the next write replaces it.
    return [];
  }
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (entry): entry is ICaseReaction =>
      typeof entry === 'object' &&
      entry !== null &&
      typeof (entry as ICaseReaction).feedItemId === 'string' &&
      typeof (entry as ICaseReaction).caseId === 'string' &&
      typeof (entry as ICaseReaction).kind === 'string' &&
      typeof (entry as ICaseReaction).askedAt === 'string',
  );
}

/** Keep the newest records; the oldest settled go first, then the oldest of the rest. */
function bounded(entries: readonly ICaseReaction[]): readonly ICaseReaction[] {
  let excess = entries.length - REACTION_LIMIT;
  if (excess <= 0) return entries;
  const dropped = new Set<ICaseReaction>();
  for (const entry of entries) {
    if (excess === 0) break;
    if (isSettled(entry)) {
      dropped.add(entry);
      excess -= 1;
    }
  }
  for (const entry of entries) {
    if (excess === 0) break;
    if (!dropped.has(entry)) {
      dropped.add(entry);
      excess -= 1;
    }
  }
  return entries.filter((entry) => !dropped.has(entry));
}

function median(sorted: readonly number[]): number | null {
  if (sorted.length === 0) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

export function createCaseReactions(options: {
  readonly directory: string;
  /** The service kind of a connector, or undefined when it is not (or no longer) known. */
  readonly kindOf: (connectorId: string) => Promise<TConnectorKind | undefined>;
  readonly card: (feedItemId: string) => Promise<IReactionCard | undefined>;
  readonly now?: () => Date;
}): ICaseReactions {
  const now = options.now ?? (() => new Date());
  mkdirSync(options.directory, { recursive: true, mode: 0o700 });
  const path = join(options.directory, 'case-reactions.json');
  const locked = createSharedLock(
    join(realpathSync(options.directory), '.write.lock'),
    'The case reactions',
  );
  const save = (entries: readonly ICaseReaction[]): void =>
    writeAtomically(path, { reactions: bounded(entries) });

  const reconcileLocked = async (): Promise<void> => {
    const stamp = now().toISOString();
    let changed = false;
    const next: ICaseReaction[] = [];
    for (const entry of read(path)) {
      const card =
        entry.dismissedAt === undefined ? await options.card(entry.feedItemId) : undefined;
      if (card === undefined) {
        next.push(entry);
        continue;
      }
      const state = card.question?.state;
      const answeredAt =
        entry.answeredAt ??
        (state === 'answered' ? (card.question?.answer?.at ?? stamp) : undefined);
      const withdrawnAt = entry.withdrawnAt ?? (state === 'withdrawn' ? stamp : undefined);
      const dismissedAt = card.dismissed ? stamp : undefined;
      if (
        answeredAt === entry.answeredAt &&
        withdrawnAt === entry.withdrawnAt &&
        dismissedAt === undefined
      ) {
        next.push(entry);
        continue;
      }
      changed = true;
      next.push({
        feedItemId: entry.feedItemId,
        caseId: entry.caseId,
        kind: entry.kind,
        askedAt: entry.askedAt,
        ...(answeredAt !== undefined && { answeredAt }),
        ...(withdrawnAt !== undefined && { withdrawnAt }),
        ...(dismissedAt !== undefined && { dismissedAt }),
      });
    }
    if (changed) save(next);
  };

  return {
    asked: async (event) => {
      const connectorId = event.case.origin.connectorId;
      const kind: TReactionKind =
        connectorId === undefined ? 'none' : ((await options.kindOf(connectorId)) ?? 'none');
      await locked(async () => {
        const entries = read(path);
        if (entries.some((entry) => entry.feedItemId === event.item.id)) return;
        save([
          ...entries,
          {
            feedItemId: event.item.id,
            caseId: event.case.id,
            kind,
            askedAt: event.case.question?.askedAt ?? event.item.at,
          },
        ]);
      });
    },
    reconcile: () => locked(reconcileLocked),
    summary: async () => {
      try {
        await locked(reconcileLocked);
      } catch {
        // allow-fallback: a busy store still reports what it holds; the next read settles it.
      }
      const clock = now().getTime();
      const groups = new Map<TReactionKind, ICaseReaction[]>();
      for (const entry of read(path)) {
        const group = groups.get(entry.kind) ?? [];
        group.push(entry);
        groups.set(entry.kind, group);
      }
      const result: Partial<Record<TReactionKind, IReactionSummary>> = {};
      for (const [kind, group] of groups) {
        const answered = group.filter((entry) => entry.answeredAt !== undefined);
        const seconds = answered
          .map((entry) => (Date.parse(entry.answeredAt!) - Date.parse(entry.askedAt)) / 1000)
          .filter((value) => Number.isFinite(value))
          .map((value) => Math.max(0, value))
          .sort((a, b) => a - b);
        const pending = group.filter(
          (entry) => entry.answeredAt === undefined && entry.withdrawnAt === undefined,
        );
        const overdue = pending.filter(
          (entry) => clock - Date.parse(entry.askedAt) > OPEN_WINDOW_MS,
        ).length;
        const withdrawn = group.filter(
          (entry) => entry.answeredAt === undefined && entry.withdrawnAt !== undefined,
        ).length;
        result[kind] = {
          asked: group.length,
          answered: answered.length,
          unanswered: withdrawn + overdue,
          open: pending.length - overdue,
          dismissed: group.filter((entry) => entry.dismissedAt !== undefined).length,
          medianSecondsToAnswer: median(seconds),
        };
      }
      return result;
    },
  };
}
