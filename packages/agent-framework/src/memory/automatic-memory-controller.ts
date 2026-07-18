import { createFileSystemMemoryStore } from './file-system-memory-store.js';
import { RegexMemoryCandidateExtractor } from './memory-candidate-extractor.js';
import { MemoryPolicyEvaluator } from './memory-policy-evaluator.js';

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
  cwd: string;
  config: IAutomaticMemoryConfig;
  extractor?: IMemoryCandidateExtractor;
  now?: () => Date;
  /**
   * SELFHOST-008: the durable-memory port the capture path reads/writes through. Defaults to the neutral
   * filesystem reference adapter over `cwd`, so post-turn capture works unchanged; a surface may inject
   * an alternate `IMemoryStore` to swap the backend without a library change.
   */
  memoryStore?: IMemoryStore;
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
    // SELFHOST-008: read/write durable + pending memory through the injected port, defaulting to the
    // neutral fs reference adapter (composes the same ProjectMemoryStore/PendingMemoryStore/recall).
    this.store = options.memoryStore ?? createFileSystemMemoryStore(options.cwd, this.now);
  }

  retrieve(query: string): IMemoryRetrievalResult {
    if (this.config.policy === 'disabled') {
      return { content: '', references: [], truncated: false };
    }
    return this.store.recall(query, this.config.retrieval);
  }

  capture(input: Omit<IMemoryExtractionInput, 'now'>): IMemoryCaptureResult {
    const extractionInput: IMemoryExtractionInput = { ...input, now: this.now() };
    const candidates = this.extractor.extract(extractionInput);
    const events: IMemoryEvent[] = [];
    const queued: IMemoryPendingRecord[] = [];
    const saved: string[] = [];

    for (const candidate of candidates) {
      events.push(this.event('memory_candidate_extracted', candidate.id, candidate.topic));
      const decision = this.evaluator.evaluate(candidate, this.config);
      if (decision.action === 'save') {
        this.store.append(candidate);
        this.store.upsertPending(candidate, 'saved', decision.reason);
        saved.push(candidate.id);
        events.push(
          this.event('memory_candidate_saved', candidate.id, candidate.topic, decision.reason),
        );
      } else if (decision.action === 'queue') {
        this.store.upsertPending(candidate, 'pending', decision.reason);
        const record = this.store.getPending(candidate.id);
        if (record) queued.push(record);
        events.push(
          this.event('memory_candidate_queued', candidate.id, candidate.topic, decision.reason),
        );
      } else {
        this.store.upsertPending(candidate, 'skipped', decision.reason);
        events.push(
          this.event('memory_candidate_skipped', candidate.id, candidate.topic, decision.reason),
        );
      }
    }

    return { events, queued, saved };
  }

  listPending(): IMemoryPendingRecord[] {
    return this.store.listPending('pending');
  }

  approve(id: string): IMemoryPendingRecord {
    const record = this.store.markPending(id, 'approved', 'approved-by-user');
    this.store.append(record);
    return this.store.markPending(id, 'saved', 'approved-and-saved');
  }

  reject(id: string): IMemoryPendingRecord {
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
  return `<project-memory>\n${retrieval.content}\n</project-memory>`;
}
