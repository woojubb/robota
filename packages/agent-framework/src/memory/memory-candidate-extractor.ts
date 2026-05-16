import { createHash } from 'node:crypto';
import type { IMemoryCandidate, IMemoryExtractionInput } from './automatic-memory-types.js';
import type { TMemoryType } from './project-memory-store.js';

export interface IMemoryCandidateExtractor {
  extract(input: IMemoryExtractionInput): IMemoryCandidate[];
}

const REMEMBER_PATTERNS: readonly RegExp[] = [
  /\bremember\s+(?:that\s+|to\s+)?(.+)/i,
  /기억해(?:줘|두세요|둬)?[:\s]+(.+)/,
  /앞으로\s+(.+)/,
  /항상\s+(.+)/,
];

const PROJECT_TERMS =
  /\b(repo|repository|project|build|test|package|workspace|monorepo)\b|프로젝트/iu;
const PREFERENCE_TERMS = /\b(always|prefer|preference|use|avoid)\b|앞으로|항상|선호/iu;
const MAX_CANDIDATE_TEXT_LENGTH = 240;
const HASH_ID_LENGTH = 12;
const HIGH_CONFIDENCE = 0.9;
const MEDIUM_CONFIDENCE = 0.75;

function hashCandidate(seed: string): string {
  return `mem_${createHash('sha1').update(seed).digest('hex').slice(0, HASH_ID_LENGTH)}`;
}

function normalizeText(text: string): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, MAX_CANDIDATE_TEXT_LENGTH);
}

function classify(text: string): TMemoryType {
  if (PROJECT_TERMS.test(text)) return 'project';
  if (PREFERENCE_TERMS.test(text)) return 'user';
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

function confidenceFor(pattern: RegExp): number {
  return pattern.source.includes('remember') || pattern.source.includes('기억')
    ? HIGH_CONFIDENCE
    : MEDIUM_CONFIDENCE;
}

export class RegexMemoryCandidateExtractor implements IMemoryCandidateExtractor {
  extract(input: IMemoryExtractionInput): IMemoryCandidate[] {
    const candidates: IMemoryCandidate[] = [];
    for (const pattern of REMEMBER_PATTERNS) {
      const match = pattern.exec(input.userMessage);
      if (!match?.[1]) continue;
      const text = normalizeText(match[1]);
      if (text.length === 0) continue;
      const type = classify(`${input.userMessage} ${text}`);
      const topic = topicFor(text, type);
      const seed = [input.sessionId, input.turnId, type, topic, text].join('\n');
      candidates.push({
        id: hashCandidate(seed),
        type,
        topic,
        text,
        sourceMessageIds: [`${input.turnId}:user`],
        confidence: confidenceFor(pattern),
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
