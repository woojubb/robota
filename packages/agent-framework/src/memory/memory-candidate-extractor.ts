import { createHash } from 'node:crypto';

import type { IMemoryCandidate, IMemoryExtractionInput } from './automatic-memory-types.js';
import type { TMemoryType } from './project-memory-store.js';

export interface IMemoryCandidateExtractor {
  extract(input: IMemoryExtractionInput): IMemoryCandidate[];
}

/** A memory-cue trigger: the first capture group of `pattern` becomes the candidate text. */
export interface IMemoryExtractorTrigger {
  pattern: RegExp;
  confidence: number;
}

/**
 * NEUT-007: extractor POLICY — trigger phrases and classification vocabulary are
 * locale/domain policy, injectable by the composition root. The library holds no
 * baked-in locale/domain heuristics beyond the documented default below.
 */
export interface IMemoryExtractorPolicy {
  /** Memory-cue triggers, evaluated in order against the user message. */
  triggers: readonly IMemoryExtractorTrigger[];
  /** Vocabulary classifying a candidate as project-scoped memory. */
  projectTerms: RegExp;
  /** Vocabulary classifying a candidate as user-preference memory. */
  preferenceTerms: RegExp;
}

const HIGH_CONFIDENCE = 0.9;
const MEDIUM_CONFIDENCE = 0.75;

/**
 * The DOCUMENTED default policy: bilingual (English/Korean) memory cues plus a
 * software-project vocabulary. Composition roots supply their own
 * `IMemoryExtractorPolicy` to replace it (other locales, other domains).
 */
export const DEFAULT_MEMORY_EXTRACTOR_POLICY: IMemoryExtractorPolicy = {
  triggers: [
    { pattern: /\bremember\s+(?:that\s+|to\s+)?(.+)/i, confidence: HIGH_CONFIDENCE },
    { pattern: /기억해(?:줘|두세요|둬)?[:\s]+(.+)/, confidence: HIGH_CONFIDENCE },
    { pattern: /앞으로\s+(.+)/, confidence: MEDIUM_CONFIDENCE },
    { pattern: /항상\s+(.+)/, confidence: MEDIUM_CONFIDENCE },
  ],
  projectTerms: /\b(repo|repository|project|build|test|package|workspace|monorepo)\b|프로젝트/iu,
  preferenceTerms: /\b(always|prefer|preference|use|avoid)\b|앞으로|항상|선호/iu,
};

const MAX_CANDIDATE_TEXT_LENGTH = 240;
const HASH_ID_LENGTH = 12;

function hashCandidate(seed: string): string {
  return `mem_${createHash('sha1').update(seed).digest('hex').slice(0, HASH_ID_LENGTH)}`;
}

function normalizeText(text: string): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, MAX_CANDIDATE_TEXT_LENGTH);
}

function classify(text: string, policy: IMemoryExtractorPolicy): TMemoryType {
  if (policy.projectTerms.test(text)) return 'project';
  if (policy.preferenceTerms.test(text)) return 'user';
  return 'reference';
}

function topicFor(text: string, type: TMemoryType): string {
  if (type === 'project') return 'project';
  if (type === 'user') return 'preferences';
  const firstWord = text
    .toLowerCase()
    .split(/\s+/)
    .find((word) => word.length > 2);
  return firstWord ?? 'general';
}

export class RegexMemoryCandidateExtractor implements IMemoryCandidateExtractor {
  private readonly policy: IMemoryExtractorPolicy;

  constructor(policy: IMemoryExtractorPolicy = DEFAULT_MEMORY_EXTRACTOR_POLICY) {
    this.policy = policy;
  }

  extract(input: IMemoryExtractionInput): IMemoryCandidate[] {
    const candidates: IMemoryCandidate[] = [];
    for (const trigger of this.policy.triggers) {
      const match = trigger.pattern.exec(input.userMessage);
      if (!match?.[1]) continue;
      const text = normalizeText(match[1]);
      if (text.length === 0) continue;
      const type = classify(`${input.userMessage} ${text}`, this.policy);
      const topic = topicFor(text, type);
      const seed = [input.sessionId, input.turnId, type, topic, text].join('\n');
      candidates.push({
        id: hashCandidate(seed),
        type,
        topic,
        text,
        sourceMessageIds: [`${input.turnId}:user`],
        confidence: trigger.confidence,
        createdAt: input.now.toISOString(),
        reason: 'explicit-memory-cue',
      });
    }
    return dedupeCandidates(candidates);
  }
}

function dedupeCandidates(candidates: IMemoryCandidate[]): IMemoryCandidate[] {
  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    const key = `${candidate.type}:${candidate.topic}:${candidate.text}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
