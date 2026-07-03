/**
 * Room — shared-transcript multi-agent primitive (ROOM-001).
 *
 * The opposite composition from subagents (isolation/parallel): N agents contribute
 * sequentially to ONE shared append-only transcript, with a pluggable "who speaks next"
 * policy. Per-agent execution stays `Robota`; the room owns transcript fan-in and turn
 * scheduling.
 */

import type { Robota, TUniversalMessage } from '@robota-sdk/agent-core';

/** A named participant. Pair with `retainHistory: false` agents — the room re-renders the
 * shared transcript into every turn's input, so instance history would only duplicate it. */
export interface IRoomMember {
  /** Unique speaker name used for attribution and turn selection. */
  name: string;
  agent: Robota;
  /** Optional persona line rendered into this member's turn input. */
  persona?: string;
}

/** One committed turn on the shared transcript. */
export interface IRoomTranscriptEntry {
  speaker: string;
  content: string;
  /** The underlying append-only store message (id, timestamp, metadata.speaker). */
  message: TUniversalMessage;
}

/** Read-only view handed to turn selectors. */
export interface IRoomView {
  transcript: readonly IRoomTranscriptEntry[];
  /** Member names in join order. */
  members: readonly string[];
  /** Number of committed turns so far. */
  turnCount: number;
}

/** Pluggable "who speaks next" policy. Return `null` to end the conversation. */
export interface ITurnSelector {
  next(view: IRoomView): Promise<string | null>;
}

export interface IRoomRunOptions {
  selector: ITurnSelector;
  /**
   * Hard safety cap on turns for this run (the selector's `null` is the intended
   * termination signal). Default 20.
   */
  maxTurns?: number;
  /** Cooperative cancellation — checked before each turn. */
  signal?: AbortSignal;
  /** Called after each committed turn. */
  onTurn?: (entry: IRoomTranscriptEntry) => void;
}

export interface IRoomOptions {
  /** Optional topic line rendered at the top of every turn input. */
  topic?: string;
  /** Max messages retained by the shared transcript store (append-only). Default 1000. */
  maxTranscriptMessages?: number;
}
