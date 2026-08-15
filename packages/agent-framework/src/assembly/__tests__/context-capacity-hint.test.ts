/**
 * NEUT-005 wave 2 — surface-derived context-capacity hint.
 *
 * The zero-dependency core emits a product-neutral hard-capacity notice and exposes the
 * `IAgentConfig.contextCapacityHint` seam. This framework tier derives a concrete, actionable
 * remediation hint from the surface's OWN registered command set: when a `compact` command is
 * composed into the session, users can act on it, so the hint names it. When no such command is
 * registered (a headless/embedded surface without slash commands), no product wording is emitted
 * and the neutral core default stands.
 */

import { describe, expect, it } from 'vitest';

import { deriveContextCapacityHint } from '../context-capacity-hint.js';

describe('deriveContextCapacityHint (NEUT-005)', () => {
  it('names an alternate role-bearing command id so the notice is actionable', () => {
    expect(deriveContextCapacityHint('reduce-context-alt')).toBe(
      'Run /reduce-context-alt and retry.',
    );
  });

  it('returns undefined when the semantic role is absent', () => {
    expect(deriveContextCapacityHint(undefined)).toBeUndefined();
  });
});
