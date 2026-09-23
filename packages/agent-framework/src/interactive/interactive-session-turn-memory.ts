/**
 * SELFHOST-008 P2/P3: the two per-turn durable-memory hooks the execution controller calls — the
 * post-turn auto-capture and the turn-start recall — over the ONE injected `IMemoryStore` (SSOT with
 * startup injection and `/memory`).
 *
 * Split out of `interactive-session.ts` (CLI-1994) along the seam the two members already drew: they
 * read the two surface-supplied policies, the shared store and the session id, and nothing else in
 * the class touches the controller or the turn counter they keep between them.
 */

import {
  AutomaticMemoryController,
  renderPerTurnRecall,
} from '../memory/automatic-memory-controller.js';

import type { IAutomaticMemoryConfig, IMemoryEvent } from '../memory/automatic-memory-types.js';
import type { IMemoryReference, IMemoryStore, IPerTurnRecallConfig } from '../memory/types.js';

export interface ISessionTurnMemoryDeps {
  /** Optional post-turn auto-capture policy (surface-supplied); absent ⇒ capture OFF. */
  readonly automaticMemory: IAutomaticMemoryConfig | undefined;
  /** Optional per-turn recall policy (surface-supplied); absent ⇒ recall OFF. */
  readonly recallMemory: IPerTurnRecallConfig | undefined;
  /** The session's durable-memory port — the SAME instance startup and `/memory` read through. */
  readonly getMemoryStore: () => IMemoryStore;
  readonly getSessionId: () => string;
  /** MEM-2055: provenance for what a recall actually used, recorded on the session's history tracker. */
  readonly recordUsedMemoryReferences: (references: readonly IMemoryReference[]) => void;
}

export class SessionTurnMemory {
  private controller?: AutomaticMemoryController;
  private turn = 0;

  constructor(private readonly deps: ISessionTurnMemoryDeps) {}

  /**
   * SELFHOST-008 P2 — post-turn auto-capture, invoked by the execution controller's `finally` (before
   * persistSession) when an `automaticMemory` policy was supplied. Extracts + evaluates + curates
   * through the SAME injected `IMemoryStore`, returning the `IMemoryEvent`s for the controller to
   * record. The controller guards this call (a capture failure never breaks the turn).
   */
  async capture(turn: { userMessage: string; assistantMessage: string }): Promise<IMemoryEvent[]> {
    if (!this.deps.automaticMemory) return [];
    this.controller ??= new AutomaticMemoryController({
      config: this.deps.automaticMemory,
      memoryStore: this.deps.getMemoryStore(),
    });
    this.turn += 1;
    const result = await this.controller.capture({
      sessionId: this.deps.getSessionId() || 'session',
      turnId: `turn-${this.turn}`,
      userMessage: turn.userMessage,
      assistantMessage: turn.assistantMessage,
    });
    return result.events;
  }

  /**
   * SELFHOST-008 P3 — per-turn recall, invoked by the execution controller at turn START (query = the
   * turn input) when a `recallMemory` policy was supplied. Recalls query-relevant durable memory
   * through the SAME injected `IMemoryStore` and renders it under a DISTINCT `<recalled-memory>`
   * label. `context` is '' when there is nothing to recall. The controller guards this call (recall
   * failure skips injection, never breaks the turn) and injects `context` EPHEMERALLY (never
   * persisted). `events` are NOT recorded here — this runs before the turn's own messages reach
   * history, so the controller records them itself once those messages are already there (MEM-2055).
   */
  async recall(query: string): Promise<{ context: string; events: IMemoryEvent[] }> {
    if (!this.deps.recallMemory) return { context: '', events: [] };
    const result = await this.deps.getMemoryStore().recall(query, this.deps.recallMemory.budget);
    const events: IMemoryEvent[] = [];
    if (result.references.length > 0) {
      this.deps.recordUsedMemoryReferences(result.references);
      const at = new Date().toISOString();
      for (const { topic, path, score, truncated } of result.references) {
        events.push({ type: 'memory_retrieved', at, topic, data: { path, score, truncated } });
      }
    }
    return { context: renderPerTurnRecall(result), events };
  }
}
