/**
 * Unit tests for tool-hook-helpers.ts
 *
 * HOOK-003 User Execution Test Scenario:
 * Verifies that runPreToolHook returns { blocked: true, reason: "..." }
 * (not { success: false, error: "Blocked by hook: ..." }) when a PreToolUse
 * hook exits with code 2.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  runPreToolHook,
  firePostToolHook,
  buildHookInput,
  truncateToolResult,
} from '../tool-hook-helpers.js';
import { runHooks, isEnforcing } from '@robota-sdk/agent-core';

import type { IHookInput, IHookTypeExecutor, THookEvent } from '@robota-sdk/agent-core';
import type { THooksConfig } from '@robota-sdk/agent-core';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeHookInput(toolName = 'bash'): IHookInput {
  return {
    session_id: 'test-session',
    cwd: '/tmp',
    hook_event_name: 'PreToolUse',
    tool_name: toolName,
    tool_input: { command: 'rm -rf /' },
  };
}

function makeMockExecutor(exitCode: number, stderr = '', stdout = ''): IHookTypeExecutor {
  // `exitCode` is kept as this helper's INPUT vocabulary so each call site still reads as the
  // condition it is describing; the executor now answers in outcomes (SEC-015).
  return {
    type: 'command',
    execute: vi
      .fn()
      .mockResolvedValue(
        exitCode === 2
          ? { outcome: 'deny', source: 'command', reason: stderr || 'Blocked by hook' }
          : exitCode === 0
            ? { outcome: 'allow', source: 'command', stdout }
            : { outcome: 'error', source: 'command', kind: 'nonzero-exit', reason: stderr },
      ),
  };
}

const baseConfig: THooksConfig = {
  PreToolUse: [
    {
      matcher: '',
      hooks: [{ type: 'command', command: 'echo "test"' }],
    },
  ],
};

// ---------------------------------------------------------------------------
// HOOK-003 core scenario: exit code 2 → blocked tool result format
// ---------------------------------------------------------------------------

describe('runPreToolHook — HOOK-003 blocked format', () => {
  it('returns { blocked: true, reason } when the hook denies', async () => {
    const executor = makeMockExecutor(2, 'Denied: dangerous tool');
    const input = makeHookInput('bash');

    const result = await runPreToolHook(baseConfig, input, [executor]);

    // Must return a non-null IToolResult (signals block to PermissionEnforcer)
    expect(result).not.toBeNull();
    expect(result).not.toBeUndefined();

    // The data must be JSON-parseable
    const data = JSON.parse(result!.data as string) as Record<string, unknown>;

    // HOOK-003: new format — { blocked: true, reason: "..." }
    expect(data['blocked']).toBe(true);
    expect(typeof data['reason']).toBe('string');
    expect(data['reason']).toContain('Denied: dangerous tool');

    // HOOK-003: old format must NOT be present
    expect(data).not.toHaveProperty('success');
    expect(data).not.toHaveProperty('error');
    expect(data).not.toHaveProperty('output');
  });

  it('uses "Blocked by hook" as reason fallback when stderr is empty', async () => {
    const executor = makeMockExecutor(2, '' /* empty stderr */);
    const input = makeHookInput('write');

    const result = await runPreToolHook(baseConfig, input, [executor]);
    expect(result).not.toBeNull();

    const data = JSON.parse(result!.data as string) as Record<string, unknown>;
    expect(data['blocked']).toBe(true);
    expect(data['reason']).toBe('Blocked by hook');
  });

  it('returns null (proceed) when hook exits with code 0', async () => {
    const executor = makeMockExecutor(0, '', 'all good');
    const input = makeHookInput('read');

    const result = await runPreToolHook(baseConfig, input, [executor]);
    expect(result).toBeNull();
  });

  it('returns null when hooks config is undefined', async () => {
    const input = makeHookInput('bash');
    const result = await runPreToolHook(undefined, input, []);
    expect(result).toBeNull();
  });

  it('returns a result that is recorded in history AND says the call was blocked', async () => {
    // The Option B design this case protects is "the tool result IS added to history, so the model
    // sees the block signal" — and that is what it must keep protecting. `success: true` was one way
    // to get there and not the property itself: `execution-round-tool-results.ts` records a
    // `success: false` result too, requiring only that it carry an `error`.
    //
    // CORE-027: a block is not a success. The result now says so, and still reaches history.
    const executor = makeMockExecutor(2, 'Access denied');
    const input = makeHookInput('bash');

    const result = (await runPreToolHook(baseConfig, input, [executor])) as unknown as {
      success: boolean;
      outcome: string;
      error: string;
      data: string;
    };

    expect(result).not.toBeNull();
    expect(result.success, 'a hook block was reported as a successful call').toBe(false);
    expect(result.outcome).toBe('hook-blocked');
    // The history path throws when a failed result carries no error message; this is what keeps the
    // block visible to the model rather than becoming an exception one layer up.
    expect(result.error.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// buildHookInput helper
// ---------------------------------------------------------------------------

describe('buildHookInput', () => {
  it('builds a complete IHookInput with all required fields', () => {
    const hi = buildHookInput('sess-1', '/home/user', 'bash', { command: 'ls' }, 'default');
    expect(hi.session_id).toBe('sess-1');
    expect(hi.cwd).toBe('/home/user');
    expect(hi.hook_event_name).toBe('PreToolUse');
    expect(hi.tool_name).toBe('bash');
    expect(hi.permission_mode).toBe('default');
  });

  it('omits permission_mode when not provided', () => {
    const hi = buildHookInput('s', '/t', 'read', {});
    expect(hi).not.toHaveProperty('permission_mode');
  });
});

// ---------------------------------------------------------------------------
// truncateToolResult helper
// ---------------------------------------------------------------------------

describe('truncateToolResult', () => {
  it('returns the result unchanged when data is within limit', () => {
    const result = { success: true, data: 'short data', metadata: {} };
    const out = truncateToolResult(result);
    expect(out.data).toBe('short data');
  });

  it('truncates in the middle when data exceeds MAX_TOOL_OUTPUT_CHARS', () => {
    // MAX_TOOL_OUTPUT_CHARS = 100_000 (from permission-types.ts)
    const bigData = 'A'.repeat(110_000);
    const result = { success: true, data: bigData, metadata: {} };
    const out = truncateToolResult(result);
    expect(typeof out.data).toBe('string');
    expect((out.data as string).length).toBeLessThan(bigData.length);
    expect(out.data as string).toContain('truncated');
  });

  it('passes through non-string data unchanged', () => {
    const result = { success: true, data: 42 as unknown as string, metadata: {} };
    const out = truncateToolResult(result);
    expect(out.data).toBe(42);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// SEC-016 — a hook that reached NO verdict does not read as approval at an enforcing event.
//
// Issue #2083 made the failure representable; these are the cases where it starts costing something.
// Every one of them ALLOWED the tool call before this change, which is what the fixture comments
// below record — a regression test whose pre-fix behaviour is not stated is a test nobody can check.
// ─────────────────────────────────────────────────────────────────────────────────────────────────
describe('SEC-016 — PreToolUse fails closed when a hook cannot evaluate', () => {
  const hooks: THooksConfig = {
    PreToolUse: [{ matcher: '', hooks: [{ type: 'command', command: 'gate' }] }],
  };

  /** An executor that reaches no verdict, in the way its `kind` names. */
  function makeFailingExecutor(
    kind: 'timeout' | 'spawn-failure' | 'malformed-response' | 'transport-failure',
    source: 'command' | 'http' = 'command',
  ): IHookTypeExecutor {
    return {
      type: 'command',
      execute: vi.fn().mockResolvedValue({
        outcome: 'error',
        source,
        kind,
        reason: `simulated ${kind}`,
      }),
    };
  }

  it('TC-01: a hook whose process cannot start blocks the call', async () => {
    // Before SEC-016: `errors` was populated and nothing read it, so this returned null → allowed.
    const result = await runPreToolHook(hooks, makeHookInput(), [
      makeFailingExecutor('spawn-failure'),
    ]);
    expect(result).not.toBeNull();
    expect(result?.success).toBe(false);
  });

  it('TC-02: a timeout blocks, and so does a malformed response', async () => {
    for (const kind of ['timeout', 'malformed-response'] as const) {
      const result = await runPreToolHook(hooks, makeHookInput(), [makeFailingExecutor(kind)]);
      expect(result, `${kind} should block`).not.toBeNull();
      expect(result?.success).toBe(false);
    }
  });

  it('TC-04: the denial reason names the failure kind and the source executor', async () => {
    // A fail-closed gate turns a misconfigured hook into a hard stop, so whoever hits it needs
    // enough in the message to fix it. Asserted per kind rather than once, because a reason that
    // happened to carry one kind's name would pass a single-case check.
    for (const [kind, source] of [
      ['timeout', 'command'],
      ['spawn-failure', 'command'],
      ['malformed-response', 'http'],
    ] as const) {
      const result = await runPreToolHook(hooks, makeHookInput(), [
        makeFailingExecutor(kind, source),
      ]);
      const reason = result?.error ?? '';
      expect(reason, `${kind} reason should name the kind`).toContain(kind);
      expect(reason, `${kind} reason should name the source`).toContain(source);
    }
  });

  it('TC-03: a configured hook type with no registered executor blocks', async () => {
    // Before SEC-016 the runner reported this on `unknownHookTypes` and the gate proceeded — so a
    // config declaring a guardrail with no registry silently disabled itself. Startup rejection of
    // such a config is issue #2099; this is the runtime half.
    const guardrailHooks: THooksConfig = {
      PreToolUse: [{ matcher: '', hooks: [{ type: 'guardrail' }] }],
    };
    const result = await runPreToolHook(guardrailHooks, makeHookInput(), []);
    expect(result).not.toBeNull();
    // The reason travels in `error` — `toolFailure` leaves `metadata` empty and puts the message
    // there, because a blocked call is rendered to the model as one error line (CORE-027).
    expect(result?.error).toContain('guardrail');
  });

  it('TC-08: an approving hook still proceeds, and an explicit deny still blocks', async () => {
    const allowed = await runPreToolHook(hooks, makeHookInput(), [makeMockExecutor(0)]);
    expect(allowed).toBeNull();

    const denied = await runPreToolHook(hooks, makeHookInput(), [makeMockExecutor(2, 'no')]);
    expect(denied).not.toBeNull();
    expect(denied?.error).toBe('no');
  });

  it('TC-03b: the SAME unknown-executor config on PostToolUse does not deny', async () => {
    // The half of TC-03 that had no test. `runPreToolHook` is PreToolUse-specific, so the contrast
    // is drawn where it is observable: the runner reports `unknownHookTypes` for both events, and
    // only the enforcing one turns that into a denial.
    const guardrailOnPost: THooksConfig = {
      PostToolUse: [{ matcher: '', hooks: [{ type: 'guardrail' }] }],
    };
    const post = await runHooks(guardrailOnPost, 'PostToolUse', makeHookInput(), []);
    expect(post.unknownHookTypes).toEqual(['guardrail']);
    expect(post.blocked).toBe(false);
    expect(isEnforcing('PostToolUse')).toBe(false);

    // Same config, enforcing event, opposite outcome.
    const guardrailOnPre: THooksConfig = {
      PreToolUse: [{ matcher: '', hooks: [{ type: 'guardrail' }] }],
    };
    const denial = await runPreToolHook(guardrailOnPre, makeHookInput(), []);
    expect(denial).not.toBeNull();
  });

  it('TC-04b: a turn with BOTH causes reports both in one denial, not one per attempt', async () => {
    // The error branch returns before the unregistered-type branch, so a config carrying both used
    // to surface only the error. The operator fixes the named cause, retries, and is stopped again
    // by a cause that was already known at the first denial. A fail-closed gate that reveals its
    // reasons one attempt at a time is a gate you debug by being repeatedly stopped.
    const both: THooksConfig = {
      PreToolUse: [
        {
          matcher: '',
          hooks: [
            // Unresolvable binary -> the command executor reports an error outcome.
            { type: 'command', command: 'definitely-not-a-real-binary-sec016' },
            // No executor supplied for this type -> reported on `unknownHookTypes`.
            { type: 'guardrail' },
          ],
        },
      ],
    };

    // A real executor for `command` so that hook produces an ERROR outcome. Passing `[]` would
    // leave `command` unregistered too — `[] ?? defaults` is `[]`, so an empty array is "no
    // executors", not "use the built-ins" — and then both hooks would take the unregistered path
    // and the test would prove nothing about combining the two causes.
    const failingCommand = {
      type: 'command' as const,
      execute: async () => ({
        outcome: 'error' as const,
        source: 'command' as const,
        kind: 'spawn-failure' as const,
        reason: 'spawn ENOENT',
      }),
    };

    const denial = await runPreToolHook(both, makeHookInput(), [failingCommand]);

    expect(denial).not.toBeNull();
    const reason = String(denial?.error ?? '');
    // The error cause, named.
    expect(reason).toContain('Hook could not evaluate');
    // AND the unregistered cause, in the SAME reason rather than on a later attempt.
    expect(reason).toContain('guardrail');
    expect(reason).toContain('no registered executor');
  });

  it('TC-05: EVERY advisory event tolerates a failed hook — all fifteen', async () => {
    // The criterion says "the fifteen advisory events", and the first version of this test drove
    // one. Review caught the gap. Driven at `runHooks`, which is where every event is observable:
    // an errored hook must report and must not block, for each advisory event by name.
    // Enumerated literally and narrowed by `isEnforcing`, rather than read from the table. Two
    // reasons: the predicate is what `agent-core`'s root barrel publishes — the table stays on the
    // hooks barrel, because one export line is the whole remaining budget against that file's frozen
    // size baseline — and a test that derived the advisory set FROM the table would be checking the
    // table against itself. `satisfies` makes the compiler reject a name that is not a THookEvent.
    const everyEvent = [
      'PreToolUse',
      'PostToolUse',
      'SessionStart',
      'SessionEnd',
      'Stop',
      'StopFailure',
      'PreCompact',
      'PostCompact',
      'UserPromptSubmit',
      'SubagentStart',
      'SubagentStop',
      'WorktreeCreate',
      'WorktreeRemove',
      'PreModelCall',
      'PostModelCall',
      'PermissionDecision',
    ] as const satisfies readonly THookEvent[];
    const advisory = everyEvent.filter((event) => !isEnforcing(event));
    expect(advisory).toHaveLength(15);

    for (const event of advisory) {
      const config: THooksConfig = {
        [event]: [{ matcher: '', hooks: [{ type: 'command', command: 'gate' }] }],
      };
      const result = await runHooks(config, event, { ...makeHookInput(), hook_event_name: event }, [
        makeFailingExecutor('timeout'),
      ]);
      // Reported…
      expect(result.errors, `${event} should report the failure`).toHaveLength(1);
      // …and not blocking. Both halves: reporting without blocking is the advisory contract, and a
      // test asserting only `blocked === false` would pass on a runner that dropped the error.
      expect(result.blocked, `${event} must not block`).toBe(false);
      expect(isEnforcing(event), `${event} must be advisory`).toBe(false);
    }
  });

  it('TC-05b: the same failure on PostToolUse does not block at the boundary', async () => {
    // `firePostToolHook` is fire-and-forget by construction, so there is no result to block on.
    // Asserted through the enforcing helper to show the difference is the EVENT, not the outcome:
    // an identical executor produces a denial at PreToolUse and nothing here.
    const postHooks: THooksConfig = {
      PostToolUse: [{ matcher: '', hooks: [{ type: 'command', command: 'gate' }] }],
    };
    const blockedAtPre = await runPreToolHook(hooks, makeHookInput(), [
      makeFailingExecutor('timeout'),
    ]);
    expect(blockedAtPre).not.toBeNull();

    // The advisory path returns void and must not throw.
    expect(() =>
      firePostToolHook(
        postHooks,
        { ...makeHookInput(), hook_event_name: 'PostToolUse' },
        { success: true, data: 'ran', metadata: {} },
        [makeFailingExecutor('timeout')],
      ),
    ).not.toThrow();
  });
});
