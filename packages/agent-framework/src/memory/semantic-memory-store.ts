/**
 * SELFHOST-008 P4 — the neutral semantic-memory adapter decorator.
 *
 * `SemanticMemoryStore` implements `IMemoryStore` by DECORATING any base `IMemoryStore` (the keyword fs reference
 * adapter, or another store) with an injected, duck-typed `ISemanticMemoryAdapter` (the surface's embedder + vector-DB
 * backend). It upgrades exactly two paths and delegates the rest:
 *
 *  - `recall(query, budget)` — **tiered**: the semantic `adapter.query()` is the primary recall; if it throws, recall
 *    DEGRADES to the keyword `base.recall()` (a genuine equivalent mechanism — the always-present baseline — declared
 *    below, NOT a fabricated/silent result). recall drives P3 per-turn recall + the `/memory` recall command, so a
 *    semantic-backend outage must never break a turn.
 *  - `append(input)` — the base durable write is awaited FIRST and is authoritative; then, ONLY when the base did not
 *    deduplicate the entry (`!result.deduplicated`), `adapter.index()` is awaited, guarded so an index failure SKIPS
 *    the vector write but keeps the durable write (declared below). Skipping index on dedup prevents duplicate vectors.
 *
 * All other `IMemoryStore` methods are pure delegation to `base` — semantic search touches only recall + index.
 *
 * **Neutrality:** this decorator imports NO vector-DB SDK; the concrete adapter is surface-injected (mirrors how
 * `E2BSandboxClient` duck-types the E2B SDK via `IE2BSandboxAdapter`). Because it IS an `IMemoryStore`, a surface
 * composes it and injects it through the existing `memoryStore` seam — the live consumers (P3 per-turn recall, P2
 * capture, `/memory`) reach it transparently with no `agent-framework` change.
 *
 * **Two sanctioned degradations** (HARNESS-028): recall-query error → keyword base; index error → skip (durable write
 * kept). Both degrade a best-effort SEMANTIC enhancement to the always-present KEYWORD baseline.
 *
 * **Known v1 limitation:** an entry durably written BEFORE the adapter was injected (or during a prior index failure)
 * returns `deduplicated: true` on re-capture and is thus permanently skipped from the vector index — it stays
 * keyword-recallable (today's behavior), but a healthy semantic `query()` (which falls back to keyword only on ERROR)
 * omits it. Bounded by the eventual-consistency posture; the robust fix is `upsert-by-id` (reserved v2 verb).
 */

import type {
  IAppendMemoryInput,
  IAppendMemoryResult,
  IMemoryBudget,
  IMemoryCandidate,
  IMemoryPendingRecord,
  IMemoryRetrievalResult,
  IMemoryStore,
  IProjectMemorySummary,
  ISemanticMemoryAdapter,
  IStartupMemory,
  TMemoryCandidateStatus,
} from './types.js';

export class SemanticMemoryStore implements IMemoryStore {
  constructor(
    private readonly base: IMemoryStore,
    private readonly adapter: ISemanticMemoryAdapter,
  ) {}

  // ── durable project memory (delegated) ─────────────────────────────────
  async loadStartupMemory(): Promise<IStartupMemory> {
    return this.base.loadStartupMemory();
  }

  async list(): Promise<IProjectMemorySummary> {
    return this.base.list();
  }

  async readTopic(topic: string): Promise<string> {
    return this.base.readTopic(topic);
  }

  /**
   * Durable base write first (authoritative), then a guarded semantic index — but only when the base actually wrote a
   * new entry (not a dedup). An index failure is a declared degradation: the durable write is kept, the vector write is
   * skipped (re-indexable later).
   */
  async append(input: IAppendMemoryInput): Promise<IAppendMemoryResult> {
    const result = await this.base.append(input);
    if (!result.deduplicated) {
      try {
        // ADAPTER CONTRACT: `index` receives the RAW `IAppendMemoryInput`. The durable store may normalize the topic
        // (truncate/default) when writing; a query hit's `references.topic` must resolve to the durable topic file, so
        // the injected adapter MUST normalize its index/query keys the same way the durable store does (or key off a
        // stable id). This is a surface-adapter responsibility — the neutral decorator passes the input through.
        await this.adapter.index(input);
      } catch {
        // allow-fallback: semantic index is best-effort over the authoritative durable keyword write (SELFHOST-008 P4
        // declared degradation); an index failure keeps the durable entry (keyword-recallable, re-indexable) and never
        // throws out of append.
      }
    }
    return result;
  }

  // ── budgeted recall (tiered: semantic primary, keyword fallback) ────────
  async recall(query: string, budget: IMemoryBudget): Promise<IMemoryRetrievalResult> {
    try {
      const hit = await this.adapter.query(query, budget);
      return { content: hit.content, references: hit.references, truncated: false };
    } catch {
      // allow-fallback: on a semantic-backend error, recall degrades to the always-present keyword base recall (a
      // genuine equivalent mechanism, not a fabricated result) so a turn's recall is never broken (SELFHOST-008 P4
      // declared degradation).
      return this.base.recall(query, budget);
    }
  }

  // ── curation queue (delegated) ─────────────────────────────────────────
  async getPending(id: string): Promise<IMemoryPendingRecord | undefined> {
    return this.base.getPending(id);
  }

  async listPending(status?: TMemoryCandidateStatus): Promise<IMemoryPendingRecord[]> {
    return this.base.listPending(status);
  }

  async markPending(
    id: string,
    status: TMemoryCandidateStatus,
    reason: string,
  ): Promise<IMemoryPendingRecord> {
    return this.base.markPending(id, status, reason);
  }

  async upsertPending(
    candidate: IMemoryCandidate,
    status: TMemoryCandidateStatus,
    reason: string,
  ): Promise<void> {
    return this.base.upsertPending(candidate, status, reason);
  }
}

/**
 * Compose a base `IMemoryStore` with a semantic adapter into a semantic-upgraded store (mirrors
 * `createFileSystemMemoryStore`). The surface supplies the concrete `ISemanticMemoryAdapter`.
 */
export function createSemanticMemoryStore(
  base: IMemoryStore,
  adapter: ISemanticMemoryAdapter,
): IMemoryStore {
  return new SemanticMemoryStore(base, adapter);
}
