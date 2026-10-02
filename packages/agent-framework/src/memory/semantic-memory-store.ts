/**
 * Semantic recall ranks references; durable source files supply the current knowledge. Hits with
 * unknown topics or paths are discarded, so stale or foreign index content cannot restore memory.
 * Query failures degrade to keyword recall; automatic indexing remains best-effort after a durable
 * append. User correction/forgetting requires explicit topic removal support and reports failures.
 * Mutations through this instance run in order, preventing an earlier index write from overtaking
 * a later removal. Concrete adapters own consistency across clients and durable deletion guarantees.
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
  private mutations: Promise<void> = Promise.resolve();
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
    return this.mutate(async () => {
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
    });
  }

  private mutate<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.mutations.then(operation);
    this.mutations = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }

  async replaceTopic(input: IAppendMemoryInput) {
    if (!this.base.replaceTopic || !this.adapter.removeTopic)
      throw new Error(
        'Memory correction requires durable replaceTopic and semantic removeTopic support.',
      );
    return this.mutate(async () => {
      const result = await this.base.replaceTopic!(input);
      await this.adapter.removeTopic!(result.topic);
      await this.adapter.index({ ...input, topic: result.topic });
      return result;
    });
  }

  async forgetTopic(topic: string) {
    if (!this.base.forgetTopic || !this.adapter.removeTopic)
      throw new Error(
        'Memory forgetting requires durable forgetTopic and semantic removeTopic support.',
      );
    return this.mutate(async () => {
      const result = await this.base.forgetTopic!(topic);
      await this.adapter.removeTopic!(result.topic);
      return result;
    });
  }

  // ── budgeted recall (tiered: semantic primary, keyword fallback) ────────
  async recall(query: string, budget: IMemoryBudget): Promise<IMemoryRetrievalResult> {
    try {
      const hit = await this.adapter.query(query, budget);
      // The index ranks topics; only current durable source content is knowledge. This prevents a
      // stale index or a foreign project reference from restoring corrected/forgotten text.
      const summary = await this.base.list();
      const known = new Map(summary.topics.map((topic) => [topic.name, topic.path]));
      const references: IMemoryRetrievalResult['references'] = [];
      const sections: string[] = [];
      const seen = new Set<string>();
      let truncated = false;
      for (const reference of hit.references) {
        if (references.length >= Math.max(0, budget.maxTopics)) break;
        if (seen.has(reference.topic) || known.get(reference.topic) !== reference.path) continue;
        seen.add(reference.topic);
        const content = await this.base.readTopic(reference.topic);
        if (!content.trim()) continue;
        const limited = content.slice(0, Math.max(0, budget.maxTopicChars));
        const cut = limited.length < content.length;
        truncated ||= cut;
        sections.push(`### ${reference.topic}\n${limited}`);
        references.push({ ...reference, truncated: cut });
      }
      return { content: sections.join('\n\n'), references, truncated };
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
