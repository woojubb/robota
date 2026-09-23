/**
 * CORE-027 — a tool result must be able to say that the tool failed.
 *
 * Three distinct outcomes are currently indistinguishable from success at the wrapper's return
 * value, because failure is smuggled into a success-shaped value as a nested JSON string:
 *
 *   a tool that THREW      -> { success: true, data: '{"success":false,…}' }
 *   a user DENIAL          -> { success: true, data: '{"success":false,…}' }
 *   a hook BLOCK           -> the same shape again
 *
 * Every consumer above has to parse prose out of `data` and guess, and the guess is the same one
 * three times. The framing to keep is the one the audit stated: **"never throw" is correct and
 * "encode the failure as success" is not — they are independent decisions.** The fix is not to
 * start throwing.
 *
 * These cases assert the DISTINCTION, not a particular envelope: whatever shape the result takes, a
 * caller must be able to tell a crash from a denial from a success without reading English out of a
 * string.
 */
import { describe, it, expect, vi } from 'vitest';

import { PermissionEnforcer } from '../permission-enforcer.js';

import { toolFailure } from '../permission-types.js';

import type { IPermissionEnforcerOptions } from '../permission-types.js';
import type { ITerminalOutput } from '@robota-sdk/agent-core';

function makeNoopTerminal(): ITerminalOutput {
  return {
    write: vi.fn(),
    writeLine: vi.fn(),
    writeMarkdown: vi.fn(),
    writeError: vi.fn(),
    prompt: vi.fn().mockResolvedValue(''),
    select: vi.fn().mockResolvedValue(0),
    spinner: vi.fn().mockReturnValue({ stop: vi.fn(), update: vi.fn() }),
  };
}

function makeEnforcer(overrides: Partial<IPermissionEnforcerOptions> = {}): PermissionEnforcer {
  return new PermissionEnforcer({
    sessionId: 'test-session',
    cwd: '/tmp',
    // `bypassPermissions` so the tool actually RUNS: a crash case must be about the crash, and the
    // first version was denied instead, which made the listener case pass on the denial's own end
    // event — green for a reason unrelated to what it asserts.
    getPermissionMode: () => 'bypassPermissions',
    config: { permissions: { allow: [], deny: [] } },
    terminal: makeNoopTerminal(),
    // The tool must actually RUN for a crash case to be about the crash. With the default config it
    // was denied instead, and the listener case then passed on the denial's own end event — green
    // for a reason that has nothing to do with what it asserts.
    permissionHandler: async () => true,
    ...overrides,
  });
}

/** A tool whose `execute` does whatever the case needs. */
function makeTool(name: string, execute: () => Promise<unknown>) {
  return {
    // `getName()` is what the wrapper calls. Supplying only `name` made the WRAPPER throw, so the
    // first run of these cases was red for the fixture rather than for the defect — a red that
    // proves nothing, which is the accidental-green's mirror image.
    getName: () => name,
    name,
    description: `${name} for a test`,
    parameters: { type: 'object' as const, properties: {} },
    execute: execute as never,
    setEventService: vi.fn(),
  } as never;
}

describe('CORE-027: a crashed tool is not a success', () => {
  it('does not report a thrown tool as `success: true`', async () => {
    const enforcer = makeEnforcer();
    const [wrapped] = enforcer.wrapTools([
      makeTool('Explode', async () => {
        throw new Error('the tool blew up');
      }),
    ]);

    const result = (await wrapped.execute({}, undefined as never)) as {
      success: boolean;
      data: unknown;
    };

    // The whole defect in one assertion: today this is `true`, and `data` carries the failure as a
    // JSON string nobody above is obliged to parse.
    expect(result.success, `crash reported as success, data=${JSON.stringify(result.data)}`).toBe(
      false,
    );
  });

  it('reports the crash to the execution listener as a failure', async () => {
    const onToolExecution = vi.fn();
    const enforcer = makeEnforcer({ onToolExecution });
    const [wrapped] = enforcer.wrapTools([
      makeTool('Explode', async () => {
        throw new Error('the tool blew up');
      }),
    ]);

    await wrapped.execute({}, undefined as never);

    const ended = onToolExecution.mock.calls.map(([e]) => e).filter((e) => e.type === 'end');
    expect(ended, 'no end event was emitted for a crashed tool').toHaveLength(1);
    expect(ended[0].success, 'a crashed tool was announced as a successful one').toBe(false);
  });
});

describe('CORE-027: the wrapper still never throws', () => {
  it('survives a tool whose own name cannot be read', () => {
    // The comment above this wrapper says it must NEVER throw: if it does, the round records the
    // assistant tool_use with no tool_result and the conversation is corrupted. A first version of
    // this change hoisted `tool.getName()` above the try to make the name available to the catch —
    // putting an unguarded call above that very comment. Review caught it.
    const enforcer = makeEnforcer();
    const broken = {
      getName: () => {
        throw new Error('this tool cannot say what it is');
      },
      name: 'Broken',
      description: 'a tool that cannot name itself',
      parameters: { type: 'object' as const, properties: {} },
      execute: (async () => ({ success: true })) as never,
      setEventService: vi.fn(),
    } as never;

    const [wrapped] = enforcer.wrapTools([broken]);

    return expect(wrapped.execute({}, undefined as never)).resolves.toMatchObject({
      success: false,
    });
  });

  it('names the hook block as its own outcome, not as a success', () => {
    // The third of the three outcomes the failure type declares. It was left behind by the first
    // pass: the type promised the distinction while `tool-hook-helpers` still returned
    // `success: true` — the type asserting a property the code did not have, in the change whose
    // subject is exactly that.
    expect(toolFailure('hook-blocked', 'nope').success).toBe(false);
    expect(toolFailure('hook-blocked', 'nope').outcome).toBe('hook-blocked');
  });
});

describe('CORE-027: what the model is told about a failure', () => {
  it('carries the reason in `error`, which is what the history writer renders', () => {
    // Review corrected a false claim here, and the correction is worth a case rather than a comment.
    // Before this change a blocked call was `success: true`, so the JSON payload reached the model
    // untouched. Now `success: false` reaches `ToolManager.executeTool`, which throws;
    // `ToolExecutionService` catches and returns `{ success: false, error }`; and the history writer
    // renders that as `Error: <message>`.
    //
    // So the model reads one error line instead of a JSON envelope — INTENDED, and the point of the
    // item: a blocked call is a failure, and being told so plainly beats being handed a
    // success-shaped value to introspect. The reason must therefore travel in `error`, not only in
    // `data`, or the correction loses the thing the model needs.
    const blocked = toolFailure('hook-blocked', 'Access denied by policy');

    expect(blocked.error).toBe('Access denied by policy');
    expect(
      blocked.error.length,
      'the history writer throws on a failed result with no error',
    ).toBeGreaterThan(0);
  });
});

describe('CORE-027: a denial, a crash and a success are three different things', () => {
  it('tells a denial apart from a crash without reading prose', async () => {
    const denying = makeEnforcer({
      getPermissionMode: () => 'default',
      permissionHandler: async () => false,
    });
    const [deniedTool] = denying.wrapTools([makeTool('Blocked', async () => ({ success: true }))]);

    const crashing = makeEnforcer();
    const [crashedTool] = crashing.wrapTools([
      makeTool('Explode', async () => {
        throw new Error('the tool blew up');
      }),
    ]);

    const denied = (await deniedTool.execute({}, undefined as never)) as Record<string, unknown>;
    const crashed = (await crashedTool.execute({}, undefined as never)) as Record<string, unknown>;

    // Not "they have different English in a string" — a caller must be able to branch on this.
    expect(
      denied['reason'] ?? denied['outcome'] ?? denied['error'],
      'a denial carries no machine-readable reason',
    ).toBeDefined();
    expect(
      String(denied['reason'] ?? denied['outcome'] ?? ''),
      'a denial and a crash are the same value',
    ).not.toBe(String(crashed['reason'] ?? crashed['outcome'] ?? ''));
  });

  it('leaves an ordinary success alone', async () => {
    // The other half of every guard: the change must not make a working tool look broken.
    const enforcer = makeEnforcer();
    const [wrapped] = enforcer.wrapTools([
      makeTool('Fine', async () => ({ success: true, data: 'ok' })),
    ]);

    const result = (await wrapped.execute({}, undefined as never)) as { success: boolean };

    expect(result.success).toBe(true);
  });
});
