import type { TRoleModelMap } from '@robota-sdk/agent-core';

/**
 * SELFHOST-006 — the concrete per-role model routing set.
 *
 * This is the app-workflow OPINION (`planner`/`editor`/`reviewer`) that the neutral `TRoleModelMap`
 * contract deliberately does NOT embed. Each role maps to an ordered fallback chain — the primary
 * first, then an alternate provider+model to fall back to on a provider error. Consumers can override
 * or extend this map; the role ids are opaque strings.
 */
export const DEFAULT_ROLE_MODELS: TRoleModelMap = {
  // Strong reasoning for planning; fall back to a different provider's reasoning model.
  planner: [
    { provider: 'anthropic', model: 'claude-opus-4-5' },
    { provider: 'openai', model: 'o3' },
  ],
  // Fast/cheaper model for edits; fall back across providers.
  editor: [
    { provider: 'anthropic', model: 'claude-sonnet-4-5' },
    { provider: 'openai', model: 'gpt-4o' },
  ],
  // Balanced model for review.
  reviewer: [
    { provider: 'anthropic', model: 'claude-sonnet-4-5' },
    { provider: 'openai', model: 'gpt-4o' },
  ],
};
