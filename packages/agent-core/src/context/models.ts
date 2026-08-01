/**
 * Claude model definitions — SSOT for model metadata.
 * Source: https://platform.claude.com/docs/en/about-claude/models/overview
 */

import { createLogger } from '../utils/logger';

const logger = createLogger('agent-core:models');

/**
 * One line per unknown model, not one per call. `getModelContextWindow` runs on every round, and a
 * warning repeated a thousand times is a warning nobody reads.
 */
const warnedModels = new Set<string>();

function warnUnknownModel(modelId: string, what: string, fallback: number): void {
  const key = `${modelId}:${what}`;
  if (warnedModels.has(key)) return;
  warnedModels.add(key);
  logger.warn(
    `No metadata registered for model "${modelId}"; using the default ${what} of ${fallback}. ` +
      "This number belongs to a different vendor's models — register the model through " +
      'registerModelMetadata() from the package that owns it. (NEUT-010)',
  );
}

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
export const DEFAULT_CONTEXT_WINDOW = 200_000;

/**
 * Model metadata contributed by a provider package. NEUT-010.
 *
 * This package used to carry a CLAUDE table, against its own SPEC ("must not branch on concrete
 * provider or model names") — and `agent-provider-anthropic` imported it back out. The table now
 * lives with the package that owns those models, and every provider contributes the same way.
 *
 * The registry is the ONLY source. A model nobody registered is a model nobody owns, which is a
 * different answer from "here is a number", and the callers below say so.
 */
const registeredModels = new Map<string, IModelDefinition>();

/** Contribute model metadata from the package that owns the model. */
export function registerModelMetadata(...definitions: IModelDefinition[]): void {
  for (const definition of definitions) registeredModels.set(definition.id, definition);
}

/** Forget contributed metadata. Exposed for tests and for hosts that rebuild a registry. */
export function clearRegisteredModelMetadata(): void {
  registeredModels.clear();
}

/** The metadata known for a model ID, or `undefined` when nothing owns it. */
export function findModelDefinition(modelId: string): IModelDefinition | undefined {
  return registeredModels.get(modelId);
}

/**
 * Get context window size for a model ID.
 *
 * NEUT-010: an unknown model used to receive `DEFAULT_CONTEXT_WINDOW` — 200 000, which is CLAUDE's
 * window — with no signal at all. Every non-Claude session was therefore sized against a number
 * belonging to a different vendor's models, and the two consumers that act on it
 * (`execution-round-context.ts`, `execution-round-tools.ts`, and `agent-session`'s context-window
 * tracker) had no way to know they were working from a guess.
 *
 * The fallback remains, because these call sites need a number to plan a round with. What changes is
 * that it is no longer SILENT: falling back now says which model it could not identify. A guess that
 * announces itself can be found; one that does not is indistinguishable from knowledge.
 */
export function getModelContextWindow(modelId: string): number {
  const known = findModelDefinition(modelId)?.contextWindow;
  if (known !== undefined) return known;
  warnUnknownModel(modelId, 'context window', DEFAULT_CONTEXT_WINDOW);
  return DEFAULT_CONTEXT_WINDOW;
}

export const DEFAULT_MAX_OUTPUT = 16_384;

/** Get max output tokens for a model ID. Falls back to DEFAULT_MAX_OUTPUT, and says so. */
export function getModelMaxOutput(modelId: string): number {
  const known = findModelDefinition(modelId)?.maxOutput;
  if (known !== undefined) return known;
  warnUnknownModel(modelId, 'max output', DEFAULT_MAX_OUTPUT);
  return DEFAULT_MAX_OUTPUT;
}

/**
 * Get human-readable model name for a model ID. Falls back to the ID itself.
 *
 * No warning here: the ID is a CORRECT answer to "what should I call this model", not a guess about
 * the model's capabilities. Warning on it would train the reader to ignore the ones that matter.
 */
export function getModelName(modelId: string): string {
  return findModelDefinition(modelId)?.name ?? modelId;
}

/** Format token count as human-readable (e.g., 200K, 1M, 1.2M). Minimum unit is K. */
export function formatTokenCount(tokens: number): string {
  if (tokens >= 1_000_000) {
    const m = tokens / 1_000_000;
    return Number.isInteger(m) ? `${m}M` : `${parseFloat(m.toFixed(1))}M`;
  }
  // Minimum unit is K — values below 1000 show as "<1K" or "0K"
  if (tokens <= 0) return '0K';
  if (tokens < 1_000) return '<1K';
  const k = tokens / 1_000;
  return Number.isInteger(k) ? `${k}K` : `${parseFloat(k.toFixed(1))}K`;
}
