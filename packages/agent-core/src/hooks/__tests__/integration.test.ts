import { describe, it, expect, vi } from 'vitest';
import { runHooks } from '../hook-runner.js';
import { CommandExecutor } from '../executors/command-executor.js';
import type { THooksConfig, IHookInput, IHookTypeExecutor, THookDefinition } from '../types.js';

describe('Hook flow integration', () => {
  const baseInput: IHookInput = {
    session_id: 'integration-test',
    cwd: process.cwd(),
    hook_event_name: 'PreToolUse',
    tool_name: 'Bash',
  };

  it('should execute command hooks end-to-end', async () => {
    const config: THooksConfig = {
      PreToolUse: [
        {
          matcher: 'Bash',
          hooks: [{ type: 'command', command: 'echo allowed' }],
        },
      ],
    };

    const result = await runHooks(config, 'PreToolUse', baseInput);

    expect(result.blocked).toBe(false);
  });

  it('should block when command hook exits with code 2', async () => {
    const config: THooksConfig = {
      PreToolUse: [
        {
          matcher: 'Bash',
          hooks: [{ type: 'command', command: 'echo "denied" >&2; exit 2' }],
        },
      ],
    };

    const result = await runHooks(config, 'PreToolUse', baseInput);

    expect(result.blocked).toBe(true);
    expect(result.reason).toContain('denied');
  });

  it('should handle multiple hook types in same config', async () => {
    // Mock fetch for HTTP executor
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true }),
    });
    vi.stubGlobal('fetch', mockFetch);

    const config: THooksConfig = {
      PreToolUse: [
        {
          matcher: 'Bash',
          hooks: [
            { type: 'command', command: 'echo command-ok' },
            { type: 'http', url: 'https://example.com/hook' },
          ],
        },
      ],
    };

    const result = await runHooks(config, 'PreToolUse', baseInput);

    expect(result.blocked).toBe(false);
    expect(mockFetch).toHaveBeenCalledTimes(1);

    vi.unstubAllGlobals();
  });

  it('should skip unknown hook types gracefully', async () => {
    const config: THooksConfig = {
      PreToolUse: [
        {
          matcher: 'Bash',
          hooks: [
            // Force an unknown type for testing
            { type: 'unknown-type' as 'command', command: 'should-not-run' },
          ],
        },
      ],
    };

    // Provide only command executor — 'unknown-type' won't match any
    const executors: IHookTypeExecutor[] = [new CommandExecutor()];
    const result = await runHooks(config, 'PreToolUse', baseInput, executors);

    expect(result.blocked).toBe(false);
  });

  it('should process multiple events independently', async () => {
    const config: THooksConfig = {
      PreToolUse: [
        {
          matcher: 'Bash',
          hooks: [{ type: 'command', command: 'echo pre-tool' }],
        },
      ],
      SessionStart: [
        {
          matcher: '',
          hooks: [{ type: 'command', command: 'echo session-start' }],
        },
      ],
    };

    const preResult = await runHooks(config, 'PreToolUse', baseInput);
    expect(preResult.blocked).toBe(false);

    const sessionInput: IHookInput = {
      session_id: 'integration-test',
      cwd: process.cwd(),
      hook_event_name: 'SessionStart',
    };
    const sessionResult = await runHooks(config, 'SessionStart', sessionInput);
    expect(sessionResult.blocked).toBe(false);
  });

  it('should match tool names with regex patterns', async () => {
    const config: THooksConfig = {
      PreToolUse: [
        {
          matcher: '^(Bash|Read)$',
          hooks: [{ type: 'command', command: 'echo matched' }],
        },
      ],
    };

    // Should match Bash
    const bashResult = await runHooks(config, 'PreToolUse', baseInput);
    expect(bashResult.blocked).toBe(false);

    // Should not match Write
    const writeInput: IHookInput = { ...baseInput, tool_name: 'Write' };
    const writeResult = await runHooks(config, 'PreToolUse', writeInput);
    expect(writeResult.blocked).toBe(false);
  });

  it('should match SessionEnd hooks by reason', async () => {
    const inputs: IHookInput[] = [];
    const executor: IHookTypeExecutor = {
      type: 'command',
      async execute(_definition, input) {
        inputs.push(input);
        return { outcome: 'allow' as const, source: 'command' as const, stdout: '' };
      },
    };
    const config: THooksConfig = {
      SessionEnd: [{ matcher: 'prompt_input_exit', hooks: [{ type: 'command', command: 'noop' }] }],
    };

    await runHooks(
      config,
      'SessionEnd',
      {
        session_id: 'integration-test',
        cwd: process.cwd(),
        hook_event_name: 'SessionEnd',
        reason: 'prompt_input_exit',
      },
      [executor],
    );

    expect(inputs).toHaveLength(1);
  });

  it('should match subagent lifecycle hooks by agent type', async () => {
    const inputs: IHookInput[] = [];
    const executor: IHookTypeExecutor = {
      type: 'command',
      async execute(_definition, input) {
        inputs.push(input);
        return { outcome: 'allow' as const, source: 'command' as const, stdout: '' };
      },
    };
    const config: THooksConfig = {
      SubagentStart: [{ matcher: 'designer', hooks: [{ type: 'command', command: 'noop' }] }],
    };

    await runHooks(
      config,
      'SubagentStart',
      {
        session_id: 'integration-test',
        cwd: process.cwd(),
        hook_event_name: 'SubagentStart',
        agent_id: 'agent_1',
        agent_type: 'designer',
      },
      [executor],
    );

    expect(inputs).toHaveLength(1);
  });

  it('should return not blocked when config is undefined', async () => {
    const result = await runHooks(undefined, 'PreToolUse', baseInput);
    expect(result.blocked).toBe(false);
  });

  it('should return not blocked when event has no hooks', async () => {
    const config: THooksConfig = {
      SessionStart: [
        {
          matcher: '',
          hooks: [{ type: 'command', command: 'echo start' }],
        },
      ],
    };

    // PreToolUse has no hooks in this config
    const result = await runHooks(config, 'PreToolUse', baseInput);
    expect(result.blocked).toBe(false);
  });

  // ────────────────────────────────────────────────────────────────────────────────────────────
  // SEC-015 TC-06 / TC-07 — the outcome contract at the runner.
  //
  // These are the mutant-killing cases. The failure mode this leaf exists to prevent is an `error`
  // outcome silently folded into `allow`, and asserting `blocked` CANNOT catch it: within this
  // leaf's boundary an `error` correctly does not block (that is issue #2093's decision), so the
  // folded implementation returns the SAME `blocked` value as correct code on every enforcing path.
  // A suite that only checked `blocked` would be green against exactly the bug it was written for.
  //
  // What separates them is what a fold DESTROYS: the record that a hook failed, and the fact that a
  // failed hook said nothing. Hence the two assertions below.
  // ────────────────────────────────────────────────────────────────────────────────────────────
  describe('SEC-015 — errors are reported, not folded into a verdict', () => {
    /** An executor that always fails, in the way its `kind` names. */
    const failing = (kind: 'timeout' | 'transport-failure'): IHookTypeExecutor => ({
      type: 'command',
      execute: async () => ({
        outcome: 'error' as const,
        source: 'command' as const,
        kind,
        reason: `simulated ${kind}`,
      }),
    });

    const oneHook: THooksConfig = {
      PreToolUse: [{ matcher: '', hooks: [{ type: 'command', command: 'x' }] }],
    };

    it('TC-06: a failed hook lands in `errors` with its kind, reason and source', async () => {
      const result = await runHooks(oneHook, 'PreToolUse', baseInput, [failing('timeout')]);

      // Kill point 1. A fold-to-allow implementation leaves `errors` undefined and fails here,
      // while `blocked` below stays false either way — which is the whole point.
      expect(result.errors).toHaveLength(1);
      expect(result.errors?.[0]).toEqual({
        outcome: 'error',
        source: 'command',
        kind: 'timeout',
        reason: 'simulated timeout',
      });
      expect(result.blocked).toBe(false);
    });

    it('TC-06: `errors` is absent when every hook rendered a verdict', async () => {
      const result = await runHooks(oneHook, 'PreToolUse', baseInput, [
        {
          type: 'command',
          execute: async () => ({
            outcome: 'allow' as const,
            source: 'command' as const,
            stdout: '',
          }),
        },
      ]);
      // Absent, not an empty array: the ordinary case must draw no attention, and a caller that
      // checks `if (result.errors)` has to mean the same thing as one that checks `.length`.
      expect(result.errors).toBeUndefined();
    });

    it('TC-06: a failed hook contributes NO stdout — its output is not a response', async () => {
      // Kill point 2, independent of the first. A fold-to-allow implementation runs the errored
      // hook's stdout through the response-protocol decode and pushes it into `stdout`; correct
      // code never reads it, because a hook that failed has not said anything.
      // Carries a `stdout` an error outcome does not declare. Bound to a name rather than written
      // as a fresh literal at the call site: excess-property checking applies to literals only, so
      // this needs no cast — and a blind `as unknown as` here would be the same "trust me" the
      // contract under test exists to remove.
      const leakyOutcome = {
        outcome: 'error' as const,
        source: 'command' as const,
        kind: 'malformed-response' as const,
        reason: 'simulated',
        stdout: 'THIS MUST NOT APPEAR',
      };
      const chatty: IHookTypeExecutor = {
        type: 'command',
        execute: async () => leakyOutcome,
      };
      const result = await runHooks(oneHook, 'PreToolUse', baseInput, [chatty]);
      expect(result.stdout).toBe('');
      expect(result.stdout).not.toContain('THIS MUST NOT APPEAR');
    });

    it('TC-06: several failures are all reported, in order', async () => {
      const twoHooks: THooksConfig = {
        PreToolUse: [
          { matcher: '', hooks: [{ type: 'command', command: 'a' }] },
          { matcher: '', hooks: [{ type: 'command', command: 'b' }] },
        ],
      };
      let n = 0;
      const counting: IHookTypeExecutor = {
        type: 'command',
        execute: async () => ({
          outcome: 'error' as const,
          source: 'command' as const,
          kind: 'transport-failure' as const,
          reason: `failure ${++n}`,
        }),
      };
      const result = await runHooks(twoHooks, 'PreToolUse', baseInput, [counting]);
      expect(result.errors?.map((e) => e.reason)).toEqual(['failure 1', 'failure 2']);
    });

    it('TC-06: an error is still reported when a LATER hook blocks', async () => {
      // The blocked path returns early. A diagnostics field that is only assembled at the bottom of
      // the function would be silently dropped exactly when something went wrong — the failure mode
      // that made `unknownHookTypes` carry the same note.
      const config: THooksConfig = {
        PreToolUse: [
          { matcher: '', hooks: [{ type: 'command', command: 'fails' }] },
          { matcher: '', hooks: [{ type: 'http', url: 'blocks' }] },
        ],
      };
      const executors: IHookTypeExecutor[] = [
        failing('transport-failure'),
        {
          type: 'http',
          execute: async () => ({
            outcome: 'deny' as const,
            source: 'http' as const,
            reason: 'later denial',
          }),
        },
      ];
      const result = await runHooks(config, 'PreToolUse', baseInput, executors);
      expect(result.blocked).toBe(true);
      expect(result.reason).toBe('later denial');
      expect(result.errors).toHaveLength(1);
      expect(result.errors?.[0]?.kind).toBe('transport-failure');
    });

    it('TC-07: enforcement policy is unchanged — deny blocks, error does not', async () => {
      const deny = await runHooks(oneHook, 'PreToolUse', baseInput, [
        {
          type: 'command',
          execute: async () => ({
            outcome: 'allow' as const,
            source: 'command' as const,
            stdout: JSON.stringify({ hookSpecificOutput: { permissionDecision: 'deny' } }),
          }),
        },
      ]);
      expect(deny.blocked).toBe(true);

      const errored = await runHooks(oneHook, 'PreToolUse', baseInput, [failing('timeout')]);
      expect(errored.blocked).toBe(false);
    });
  });

  it('should support custom executor injection', async () => {
    let executedDefinition: THookDefinition | undefined;

    const customExecutor: IHookTypeExecutor = {
      type: 'command',
      async execute(definition, _input) {
        executedDefinition = definition;
        return { outcome: 'allow' as const, source: 'command' as const, stdout: 'custom' };
      },
    };

    const config: THooksConfig = {
      PreToolUse: [
        {
          matcher: 'Bash',
          hooks: [{ type: 'command', command: 'echo test' }],
        },
      ],
    };

    const result = await runHooks(config, 'PreToolUse', baseInput, [customExecutor]);

    expect(result.blocked).toBe(false);
    expect(executedDefinition).toBeDefined();
    expect(executedDefinition?.type).toBe('command');
  });
});
