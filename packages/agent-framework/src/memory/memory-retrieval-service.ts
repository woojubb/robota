import { ProjectMemoryStore } from './project-memory-store.js';

import type { IMemoryReference, IMemoryRetrievalResult } from './automatic-memory-types.js';
import type { IMemoryBudget } from './types.js';

const TOKEN_MIN_LENGTH = 3;
const TOPIC_NAME_SCORE = 4;

function tokenize(input: string): string[] {
  return input
    .toLowerCase()
    .split(/[^a-z0-9가-힣_-]+/u)
    .filter((token) => token.length >= TOKEN_MIN_LENGTH);
}

function scoreTopic(topic: string, content: string, tokens: string[]): number {
  let score = 0;
  const lowerTopic = topic.toLowerCase();
  const lowerContent = content.toLowerCase();
  for (const token of tokens) {
    if (lowerTopic.includes(token)) score += TOPIC_NAME_SCORE;
    if (lowerContent.includes(token)) score += 1;
  }
  return score;
}

function truncateContent(
  content: string,
  maxChars: number,
): { content: string; truncated: boolean } {
  if (content.length <= maxChars) return { content, truncated: false };
  return { content: `${content.slice(0, maxChars).trimEnd()}\n...`, truncated: true };
}

export class MemoryRetrievalService {
  private readonly store: ProjectMemoryStore;

  /**
   * P1R: accept an injected `ProjectMemoryStore` (so the fs adapter's single, injected-clock instance is
   * reused for the recall read path) — falling back to constructing one from `cwd` for standalone use.
   */
  constructor(cwdOrStore: string | ProjectMemoryStore) {
    this.store = typeof cwdOrStore === 'string' ? new ProjectMemoryStore(cwdOrStore) : cwdOrStore;
  }

  /** P1R: recall takes only a budget (`IMemoryBudget`) — no fabricated `IAutomaticMemoryConfig`. */
  retrieve(query: string, budget: IMemoryBudget): IMemoryRetrievalResult {
    const tokens = tokenize(query);
    if (tokens.length === 0) return { content: '', references: [], truncated: false };

    const scored = this.store
      .list()
      .topics.map((topic) => {
        const content = this.store.readTopic(topic.name);
        return {
          topic,
          content,
          score: scoreTopic(topic.name, content, tokens),
        };
      })
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, budget.maxTopics);

    const references: IMemoryReference[] = [];
    const sections: string[] = [];
    let truncated = false;

    for (const item of scored) {
      const limited = truncateContent(item.content, budget.maxTopicChars);
      truncated = truncated || limited.truncated;
      references.push({
        topic: item.topic.name,
        path: item.topic.path,
        score: item.score,
        truncated: limited.truncated,
      });
      sections.push(`### ${item.topic.name}\n${limited.content}`);
    }

    return {
      content: sections.join('\n\n'),
      references,
      truncated,
    };
  }
}
