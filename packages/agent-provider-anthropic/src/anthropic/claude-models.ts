import {
  getModelMaxOutput,
  registerModelMetadata,
  type IModelDefinition,
} from '@robota-sdk/agent-core';

/**
 * Claude model metadata — owned by the package that owns the models. NEUT-010.
 *
 * This table lived in `@robota-sdk/agent-core`, whose own SPEC says it must not branch on concrete
 * provider or model names, and this package imported it back out. Two consequences, both measured:
 * the vendor-neutral foundation carried one vendor's catalogue, and `getModelContextWindow` handed
 * every model NOT in this table a 200 000-token window — Claude's number — with no signal at all.
 *
 * Source: https://platform.claude.com/docs/en/about-claude/models/overview
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

/**
 * Contribute this package's models to the core registry.
 *
 * Called at module load below, because importing this module IS the statement that these models are
 * available: a session sized before a provider instance happens to be constructed would otherwise
 * fall back for a model this package can describe exactly.
 *
 * NOT exported. It had no caller outside this file and the orphan-export scan said so — an export
 * nobody imports is surface without a reason, which is the shape this whole audit keeps finding.
 */
function registerClaudeModels(): void {
  registerModelMetadata(...Object.values(CLAUDE_MODELS));
}

registerClaudeModels();

/**
 * The `max_tokens` to send for a request. NEUT-010.
 *
 * Lives here rather than at the two call sites in `provider.ts` because the answer comes from the
 * core registry, and this module is what puts Claude's models in it. Importing the helper therefore
 * brings the registration with it — the provider cannot ask the question without the answers being
 * present, which is what the previous shape got wrong: `provider.ts` called `getModelMaxOutput`
 * while nothing in its import graph had registered anything, and Sonnet silently received the
 * 16 384 default instead of its 64 000.
 */
export function resolveAnthropicMaxTokens(model: string, requested?: number): number {
  return requested || getModelMaxOutput(model);
}
