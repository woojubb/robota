/**
 * SEC-016 — the enforcement boundary READS the policy; it does not hard-code the event.
 *
 * `packages/agent-session/docs/SPEC.md` states this as contract: "`isEnforcing` is the SSOT; this
 * package reads it rather than hard-coding the event." Review measured that nothing pinned it —
 * unwrapping the `if (isEnforcing('PreToolUse'))` block so the gate runs unconditionally left
 * typecheck, lint, 366 agent-session tests, 119 agent-core hook tests and the reachability scan all
 * green. The boundary could stop consulting the SSOT and nothing in the repository would notice.
 *
 * That is not the same gap as issue #2259, which is table→code (a posture flip going unnoticed once
 * a second enforcing row exists). This is code→table: the boundary ceasing to read the table at all,
 * with the table unchanged.
 *
 * Driven by mocking the policy rather than by matching source text, so it asserts the behaviour the
 * SPEC sells rather than the spelling of the call.
 */

import { describe, it, expect, vi } from 'vitest';

import type { IHookTypeExecutor, THooksConfig } from '@robota-sdk/agent-core';

const isEnforcingMock = vi.hoisted(() => vi.fn(() => true));

vi.mock('@robota-sdk/agent-core', async () => {
  const actual =
    await vi.importActual<typeof import('@robota-sdk/agent-core')>('@robota-sdk/agent-core');
  return { ...actual, isEnforcing: isEnforcingMock };
});

const { runPreToolHook } = await import('../tool-hook-helpers.js');

/** A `PreToolUse` hook whose executor always reports an error outcome. */
const failing: IHookTypeExecutor = {
  type: 'command',
  execute: async () => ({
    outcome: 'error' as const,
    source: 'command' as const,
    kind: 'spawn-failure' as const,
    reason: 'stub failure text',
  }),
};

const hooks: THooksConfig = {
  PreToolUse: [{ matcher: '', hooks: [{ type: 'command', command: 'noop' }] }],
} as unknown as THooksConfig;

const input = { toolName: 'Bash', toolInput: {} } as never;

describe('SEC-016: the PreToolUse boundary consults HOOK_ENFORCEMENT_POLICY', () => {
  it('denies while the policy reports the event enforcing', () => {
    isEnforcingMock.mockReturnValue(true);

    return expect(runPreToolHook(hooks, input, [failing])).resolves.not.toBeNull();
  });

  it('does NOT deny when the policy reports the event advisory', async () => {
    // The contrast that makes the case above mean something. Identical inputs; only the table's
    // answer differs. A boundary that hard-coded the event would deny here too, and that is exactly
    // the mutation nothing caught before this file existed.
    isEnforcingMock.mockReturnValue(false);

    await expect(runPreToolHook(hooks, input, [failing])).resolves.toBeNull();
  });

  it('asks the policy about PreToolUse specifically', () => {
    isEnforcingMock.mockClear();
    isEnforcingMock.mockReturnValue(true);

    return runPreToolHook(hooks, input, [failing]).then(() => {
      expect(isEnforcingMock).toHaveBeenCalledWith('PreToolUse');
    });
  });
});
