import { PendingMemoryStore } from './pending-memory-store.js';
import { ProjectMemoryStore } from './project-memory-store.js';
import type {
  IAutomaticMemoryConfig,
  IMemoryEvent,
  IMemoryExtractionInput,
  IMemoryPendingRecord,
  IMemoryReference,
  IMemoryRetrievalResult,
} from './automatic-memory-types.js';
import { RegexMemoryCandidateExtractor } from './memory-candidate-extractor.js';
import type { IMemoryCandidateExtractor } from './memory-candidate-extractor.js';
import { MemoryPolicyEvaluator } from './memory-policy-evaluator.js';
import { MemoryRetrievalService } from './memory-retrieval-service.js';

export interface IAutomaticMemoryControllerOptions {
  cwd: string;
  config: IAutomaticMemoryConfig;
  extractor?: IMemoryCandidateExtractor;
  now?: () => Date;
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
  private readonly pendingStore: PendingMemoryStore;
  private readonly memoryStore: ProjectMemoryStore;
  private readonly retrievalService: MemoryRetrievalService;
  private readonly now: () => Date;

  constructor(options: IAutomaticMemoryControllerOptions) {
    this.config = options.config;
    this.extractor = options.extractor ?? new RegexMemoryCandidateExtractor();
    this.now = options.now ?? (() => new Date());
    this.pendingStore = new PendingMemoryStore(options.cwd, this.now);
    this.memoryStore = new ProjectMemoryStore(options.cwd, this.now);
    this.retrievalService = new MemoryRetrievalService(options.cwd);
  }

  retrieve(query: string): IMemoryRetrievalResult {
    if (this.config.policy === 'disabled') {
      return { content: '', references: [], truncated: false };
    }
    return this.retrievalService.retrieve(query, this.config);
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
        this.memoryStore.append(candidate);
        this.pendingStore.upsert(candidate, 'saved', decision.reason);
        saved.push(candidate.id);
        events.push(
          this.event('memory_candidate_saved', candidate.id, candidate.topic, decision.reason),
        );
      } else if (decision.action === 'queue') {
        this.pendingStore.upsert(candidate, 'pending', decision.reason);
        const record = this.pendingStore.get(candidate.id);
        if (record) queued.push(record);
        events.push(
          this.event('memory_candidate_queued', candidate.id, candidate.topic, decision.reason),
        );
      } else {
        this.pendingStore.upsert(candidate, 'skipped', decision.reason);
        events.push(
          this.event('memory_candidate_skipped', candidate.id, candidate.topic, decision.reason),
        );
      }
    }

    return { events, queued, saved };
  }

  listPending(): IMemoryPendingRecord[] {
    return this.pendingStore.list('pending');
  }

  approve(id: string): IMemoryPendingRecord {
    const record = this.pendingStore.mark(id, 'approved', 'approved-by-user');
    this.memoryStore.append(record);
    return this.pendingStore.mark(id, 'saved', 'approved-and-saved');
  }

  reject(id: string): IMemoryPendingRecord {
    return this.pendingStore.mark(id, 'rejected', 'rejected-by-user');
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

export function createMemoryRetrievedEvent(references: IMemoryReference[]): IMemoryEvent {
  return {
    type: 'memory_retrieved',
    at: new Date().toISOString(),
    data: { topics: references.map((reference) => reference.topic) },
  };
}
