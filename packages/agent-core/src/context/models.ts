/**
 * Claude model definitions — SSOT for model metadata.
 * Source: https://platform.claude.com/docs/en/about-claude/models/overview
 */

export interface IModelDefinition {
  /** Human-readable model name */
  name: string;
  /** API model identifier */
  id: string;
  /** Context window size in tokens */
  contextWindow: number;
  /** Maximum output tokens */
  maxOutput: number;
}

/**
 * Known Claude models (4.5+).
 * Keyed by API model ID for fast lookup.
 */
export const CLAUDE_MODELS: Record<string, IModelDefinition> = {
  'claude-opus-4-6': {
    name: 'Claude Opus 4.6',
    id: 'claude-opus-4-6',
    contextWindow: 1_000_000,
    maxOutput: 128_000,
  },
  'claude-sonnet-4-6': {
    name: 'Claude Sonnet 4.6',
    id: 'claude-sonnet-4-6',
    contextWindow: 1_000_000,
    maxOutput: 64_000,
  },
  'claude-haiku-4-5': {
    name: 'Claude Haiku 4.5',
    id: 'claude-haiku-4-5',
    contextWindow: 200_000,
    maxOutput: 64_000,
  },
  'claude-haiku-4-5-20251001': {
    name: 'Claude Haiku 4.5',
    id: 'claude-haiku-4-5-20251001',
    contextWindow: 200_000,
    maxOutput: 64_000,
  },
  'claude-sonnet-4-5': {
    name: 'Claude Sonnet 4.5',
    id: 'claude-sonnet-4-5',
    contextWindow: 200_000,
    maxOutput: 64_000,
  },
  'claude-sonnet-4-5-20250929': {
    name: 'Claude Sonnet 4.5',
    id: 'claude-sonnet-4-5-20250929',
    contextWindow: 200_000,
    maxOutput: 64_000,
  },
  'claude-opus-4-5': {
    name: 'Claude Opus 4.5',
    id: 'claude-opus-4-5',
    contextWindow: 200_000,
    maxOutput: 64_000,
  },
  'claude-opus-4-5-20251101': {
    name: 'Claude Opus 4.5',
    id: 'claude-opus-4-5-20251101',
    contextWindow: 200_000,
    maxOutput: 64_000,
  },
};

export const DEFAULT_CONTEXT_WINDOW = 200_000;

/** Get context window size for a model ID. Falls back to DEFAULT_CONTEXT_WINDOW. */
export function getModelContextWindow(modelId: string): number {
  return CLAUDE_MODELS[modelId]?.contextWindow ?? DEFAULT_CONTEXT_WINDOW;
}

/** Get human-readable model name for a model ID. Falls back to the ID itself. */
export function getModelName(modelId: string): string {
  return CLAUDE_MODELS[modelId]?.name ?? modelId;
}

/** Format token count as human-readable (e.g., 200K, 1M, 1.2M) */
export function formatTokenCount(tokens: number): string {
  if (tokens >= 1_000_000) {
    const m = tokens / 1_000_000;
    return Number.isInteger(m) ? `${m}M` : `${parseFloat(m.toFixed(1))}M`;
  }
  if (tokens >= 1_000) {
    const k = tokens / 1_000;
    return Number.isInteger(k) ? `${k}K` : `${parseFloat(k.toFixed(1))}K`;
  }
  return String(tokens);
}
