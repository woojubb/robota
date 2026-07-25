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

import type { ICommandModule } from '../../command-api/index.js';

function moduleWithSystemCommand(name: string): ICommandModule {
  return {
    name: `test-module-${name}`,
    systemCommands: [
      {
        name,
        description: 'test command',
        execute: () => ({ kind: 'text', text: '' }) as never,
      },
    ],
  };
}

describe('deriveContextCapacityHint (NEUT-005)', () => {
  it('names the registered compact command so the notice is actionable', () => {
    const hint = deriveContextCapacityHint([moduleWithSystemCommand('compact')]);
    expect(hint).toBe('Run /compact and retry.');
  });

  it('returns undefined when no compact command is registered (neutral core default stands)', () => {
    expect(deriveContextCapacityHint([moduleWithSystemCommand('help')])).toBeUndefined();
    expect(deriveContextCapacityHint([])).toBeUndefined();
    expect(deriveContextCapacityHint(undefined)).toBeUndefined();
  });
});
