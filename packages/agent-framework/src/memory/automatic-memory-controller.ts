import { RegexMemoryCandidateExtractor } from './memory-candidate-extractor.js';
import { MemoryPolicyEvaluator } from './memory-policy-evaluator.js';
import { PROJECT_MEMORY_TRUST_NOTE, RECALLED_MEMORY_TRUST_NOTE } from './memory-trust-framing.js';

import type {
  IAutomaticMemoryConfig,
  IMemoryEvent,
  IMemoryExtractionInput,
  IMemoryPendingRecord,
  IMemoryRetrievalResult,
} from './automatic-memory-types.js';
import type { IMemoryCandidateExtractor } from './memory-candidate-extractor.js';
import type { IMemoryStore } from './types.js';

export interface IAutomaticMemoryControllerOptions {
  config: IAutomaticMemoryConfig;
  extractor?: IMemoryCandidateExtractor;
  now?: () => Date;
  /**
   * Durable-memory port for the capture path. Project composition must derive this from authority;
   * non-project hosts may inject a different explicit store.
   */
  memoryStore: IMemoryStore;
}

export interface IMemoryCaptureResult {
  events: IMemoryEvent[];
  queued: IMemoryPendingRecord[];
  saved: string[];
}

export const DEFAULT_AUTOMATIC_MEMORY_CONFIG: IAutomaticMemoryConfig = {
  policy: 'approval_required',
  retrieval: {
    maxTopics: 3,
    maxTopicChars: 3000,
  },
};

export function normalizeAutomaticMemoryConfig(
  input?: Partial<IAutomaticMemoryConfig>,
): IAutomaticMemoryConfig {
  return {
    policy: input?.policy ?? DEFAULT_AUTOMATIC_MEMORY_CONFIG.policy,
    retrieval: {
      maxTopics: input?.retrieval?.maxTopics ?? DEFAULT_AUTOMATIC_MEMORY_CONFIG.retrieval.maxTopics,
      maxTopicChars:
        input?.retrieval?.maxTopicChars ?? DEFAULT_AUTOMATIC_MEMORY_CONFIG.retrieval.maxTopicChars,
    },
  };
}

export class AutomaticMemoryController {
  private readonly config: IAutomaticMemoryConfig;
  private readonly extractor: IMemoryCandidateExtractor;
  private readonly evaluator = new MemoryPolicyEvaluator();
  private readonly store: IMemoryStore;
  private readonly now: () => Date;

  constructor(options: IAutomaticMemoryControllerOptions) {
    this.config = options.config;
    this.extractor = options.extractor ?? new RegexMemoryCandidateExtractor();
    this.now = options.now ?? (() => new Date());
    this.store = options.memoryStore;
  }

  async retrieve(query: string): Promise<IMemoryRetrievalResult> {
    if (this.config.policy === 'disabled') {
      return { content: '', references: [], truncated: false };
    }
    return this.store.recall(query, this.config.retrieval);
  }

  async capture(input: Omit<IMemoryExtractionInput, 'now'>): Promise<IMemoryCaptureResult> {
    const extractionInput: IMemoryExtractionInput = { ...input, now: this.now() };
    const candidates = this.extractor.extract(extractionInput);
    const events: IMemoryEvent[] = [];
    const queued: IMemoryPendingRecord[] = [];
    const saved: string[] = [];

    for (const candidate of candidates) {
      events.push(this.event('memory_candidate_extracted', candidate.id, candidate.topic));
      const decision = this.evaluator.evaluate(candidate, this.config);
      if (decision.action === 'save') {
        await this.store.append(candidate);
        await this.store.upsertPending(candidate, 'saved', decision.reason);
        saved.push(candidate.id);
        events.push(
          this.event('memory_candidate_saved', candidate.id, candidate.topic, decision.reason),
        );
      } else if (decision.action === 'queue') {
        await this.store.upsertPending(candidate, 'pending', decision.reason);
        const record = await this.store.getPending(candidate.id);
        if (record) queued.push(record);
        events.push(
          this.event('memory_candidate_queued', candidate.id, candidate.topic, decision.reason),
        );
      } else {
        await this.store.upsertPending(candidate, 'skipped', decision.reason);
        events.push(
          this.event('memory_candidate_skipped', candidate.id, candidate.topic, decision.reason),
        );
      }
    }

    return { events, queued, saved };
  }

  async listPending(): Promise<IMemoryPendingRecord[]> {
    return this.store.listPending('pending');
  }

  async approve(id: string): Promise<IMemoryPendingRecord> {
    const record = await this.store.markPending(id, 'approved', 'approved-by-user');
    await this.store.append(record);
    return this.store.markPending(id, 'saved', 'approved-and-saved');
  }

  async reject(id: string): Promise<IMemoryPendingRecord> {
    return this.store.markPending(id, 'rejected', 'rejected-by-user');
  }

  private event(
    type: IMemoryEvent['type'],
    candidateId: string,
    topic: string,
    reason?: string,
  ): IMemoryEvent {
    return { type, at: this.now().toISOString(), candidateId, topic, ...(reason && { reason }) };
  }
}

export function renderRetrievedMemory(retrieval: IMemoryRetrievalResult): string {
  if (retrieval.content.trim().length === 0) return '';
  // SEC-007: the tags alone are delimiters, not framing — see `memory-trust-framing.ts`.
  return `<project-memory>\n${PROJECT_MEMORY_TRUST_NOTE}\n\n${retrieval.content}\n</project-memory>`;
}

/**
 * SELFHOST-008 P3: render PER-TURN recalled memory with a DISTINCT `<recalled-memory>` label, so the model
 * can tell the query-relevant bodies (injected ephemerally per turn) from the always-loaded startup
 * `<project-memory>` index. Empty when there is nothing to recall.
 */
export function renderPerTurnRecall(retrieval: IMemoryRetrievalResult): string {
  if (retrieval.content.trim().length === 0) return '';
  // SEC-007: this block is delivered as a `role: 'system'` message, which the Anthropic adapter
  // hoists into the top-level `system` field — concatenated onto the operator's own prompt, with its
  // position (and so its provenance) gone. The framing has to travel INSIDE the text to survive that.
  return `<recalled-memory>\n${RECALLED_MEMORY_TRUST_NOTE}\n\n${retrieval.content}\n</recalled-memory>`;
}
