/**
 * ARCH-013 stage 3 — the guardrail registry and retrieval adapter, from the PUBLIC surface in.
 *
 * ## What each group here guards, stated because an earlier revision got it wrong
 *
 * The `createSession` group covers pre-existing behaviour: registering a registry adds the EXECUTOR,
 * and the guardrails only fire if a `{ type: 'guardrail' }` hook exists on an enforcing event, so
 * `createSession` auto-injects a `PreToolUse` group when the config declares none. That behaviour was
 * genuinely untested from the option in — `guardrails` appeared in no `createSession` test before
 * this file — so the coverage is worth having. But review measured all of it passing on the pre-fix
 * merge-base, because it enters BELOW the hop this change touches. It guards the assembler, not the
 * fix, and the previous revision of this docblock claimed otherwise.
 *
 * The `initializeInteractiveSessionAsync` group is the one that guards the fix. It drives the
 * published option type, which is the only thing a consumer can actually reach, and it fails on the
 * pre-fix tree. Both halves are kept: one pins the mechanism, the other pins the wiring.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

import type { IResolvedConfig } from '../config/config-types.js';
import type { TGuardrail } from '@robota-sdk/agent-core';
import type { IRetrievalAdapter } from '@robota-sdk/agent-tools';
import type { IInteractiveSessionStandardOptions } from '../interactive/interactive-session-options.js';

const sessionCtorCalls: Array<Record<string, unknown>> = [];

vi.mock('@robota-sdk/agent-session', async () => {
  const actual = await vi.importActual('@robota-sdk/agent-session');
  return {
    ...actual,
    Session: vi.fn().mockImplementation((options: Record<string, unknown>) => {
      sessionCtorCalls.push(options);
      return {
        getSessionId: vi.fn().mockReturnValue('test-session-id'),
        run: vi.fn().mockResolvedValue('mock response'),
        abort: vi.fn(),
        getHistory: vi.fn().mockReturnValue([]),
        clearHistory: vi.fn(),
        injectMessage: vi.fn(),
      };
    }),
    FileSessionLogger: vi.fn().mockImplementation(() => ({})),
  };
});

vi.mock('@robota-sdk/agent-core', async () => {
  const actual = await vi.importActual('@robota-sdk/agent-core');
  return {
    ...actual,
    Robota: vi.fn().mockImplementation(() => ({
      run: vi.fn().mockResolvedValue('mock AI response'),
      getHistory: vi.fn().mockReturnValue([]),
      clearHistory: vi.fn(),
      injectMessage: vi.fn(),
    })),
    runHooks: vi.fn().mockResolvedValue({ blocked: false }),
  };
});

const MOCK_TERMINAL = {
  write: vi.fn(),
  writeLine: vi.fn(),
  writeMarkdown: vi.fn(),
  writeError: vi.fn(),
  prompt: vi.fn(),
  select: vi.fn(),
  spinner: vi.fn().mockReturnValue({ stop: vi.fn(), update: vi.fn() }),
} as never;

function createMockProvider() {
  return {
    name: 'mock',
    chat: vi.fn().mockResolvedValue({ role: 'assistant', content: 'x', timestamp: new Date() }),
  } as never;
}

function baseConfig(hooks?: IResolvedConfig['hooks']): IResolvedConfig {
  return {
    defaultTrustLevel: 'moderate' as const,
    provider: { name: 'mock', apiKey: 'test-key', model: 'test-model' },
    permissions: { allow: [], deny: [] },
    language: 'en' as const,
    env: {},
    ...(hooks ? { hooks } : {}),
  };
}

/** Every `{ type: 'guardrail' }` hook the assembled session received, across all events. */
function guardrailHooksOf(sessionOptions: Record<string, unknown>): unknown[] {
  const hooks = (sessionOptions.hooks ?? {}) as Record<
    string,
    Array<{ hooks: Array<{ type: string }> }> | undefined
  >;
  return Object.values(hooks)
    .flatMap((groups) => groups ?? [])
    .flatMap((group) => group.hooks)
    .filter((hook) => hook.type === 'guardrail');
}

const NEVER_PASSES: TGuardrail = () => ({ pass: false, reason: 'blocked by test' });

/** Hook-executor types registered on the assembled session. */
function executorTypesOf(sessionOptions: Record<string, unknown>): string[] {
  const executors = (sessionOptions.hookTypeExecutors ?? []) as Array<{ type?: string }>;
  return executors.map((executor) => executor.type ?? '').filter(Boolean);
}

/** Tool names on the assembled session. */
function toolNamesOf(sessionOptions: Record<string, unknown>): string[] {
  const tools = (sessionOptions.tools ?? []) as Array<{ getName?: () => string }>;
  return tools.map((tool) => tool.getName?.() ?? '').filter(Boolean);
}

describe('createSession registers the guardrail machinery (pre-existing, previously untested)', () => {
  beforeEach(() => {
    sessionCtorCalls.length = 0;
  });

  it('auto-injects a PreToolUse guardrail hook when a registry is supplied', async () => {
    const { createSession } = await import('../assembly/create-session.js');

    createSession({
      config: baseConfig(),
      context: { agentsMd: '', projectNotesMd: '' },
      terminal: MOCK_TERMINAL,
      provider: createMockProvider(),
      guardrails: { neverPasses: NEVER_PASSES },
    });

    expect(sessionCtorCalls).toHaveLength(1);
    expect(guardrailHooksOf(sessionCtorCalls[0]!)).toHaveLength(1);
    // The EXECUTOR half, which this file's own docblock names and an earlier revision left unasserted:
    // the hook is inert without it, so asserting only the hook proved half the mechanism.
    expect(executorTypesOf(sessionCtorCalls[0]!)).toContain('guardrail');
  });

  it('injects NOTHING when no registry is supplied — the state before this change', async () => {
    // The contrast that makes the case above mean something: identical call, registry omitted.
    const { createSession } = await import('../assembly/create-session.js');

    createSession({
      config: baseConfig(),
      context: { agentsMd: '', projectNotesMd: '' },
      terminal: MOCK_TERMINAL,
      provider: createMockProvider(),
    });

    expect(guardrailHooksOf(sessionCtorCalls[0]!)).toHaveLength(0);
  });

  it('injects nothing for an EMPTY registry, which is not the same as a supplied one', async () => {
    const { createSession } = await import('../assembly/create-session.js');

    createSession({
      config: baseConfig(),
      context: { agentsMd: '', projectNotesMd: '' },
      terminal: MOCK_TERMINAL,
      provider: createMockProvider(),
      guardrails: {},
    });

    expect(guardrailHooksOf(sessionCtorCalls[0]!)).toHaveLength(0);
  });

  it('does NOT add a second hook when the consumer already declared one', async () => {
    // Idempotence is what makes auto-injection safe: a consumer who placed their own guardrail hook
    // on a chosen event must not silently also get a blanket PreToolUse one.
    const { createSession } = await import('../assembly/create-session.js');

    createSession({
      config: baseConfig({
        PreToolUse: [
          { matcher: 'Bash', hooks: [{ type: 'guardrail', guardrails: ['neverPasses'] }] },
        ],
      } as IResolvedConfig['hooks']),
      context: { agentsMd: '', projectNotesMd: '' },
      terminal: MOCK_TERMINAL,
      provider: createMockProvider(),
      guardrails: { neverPasses: NEVER_PASSES },
    });

    const declared = guardrailHooksOf(sessionCtorCalls[0]!);
    expect(declared).toHaveLength(1);
    // The consumer's own hook survived, rather than being replaced by the blanket one.
    expect((declared[0] as { guardrails?: string[] }).guardrails).toEqual(['neverPasses']);
  });
});

describe('createSession gates CodebaseRetrieval on the adapter (pre-existing behaviour)', () => {
  beforeEach(() => {
    sessionCtorCalls.length = 0;
  });

  it('surfaces CodebaseRetrieval when an adapter is supplied', async () => {
    // `create-tools.test.ts` already covers the last hop (adapter in `createDefaultTools`'s options →
    // tool present). The hop nothing covered is this one: `createSession` → `assemble-session-tools`
    // → `createDefaultTools`. Without it, "the adapter reaches the session" was an inference across
    // two separately-tested halves rather than a measured fact.
    const { createSession } = await import('../assembly/create-session.js');
    // `retrieve`, not `search`: the gate is truthiness-only so a wrong member name would still pass,
    // which is exactly why encoding one in a cast is worth avoiding.
    const retrievalAdapter: IRetrievalAdapter = {
      retrieve: async () => ({ symbols: [], totalTokens: 0 }),
    };

    createSession({
      config: baseConfig(),
      context: { agentsMd: '', projectNotesMd: '' },
      terminal: MOCK_TERMINAL,
      provider: createMockProvider(),
      retrievalAdapter,
    });

    expect(toolNamesOf(sessionCtorCalls[0]!)).toContain('CodebaseRetrieval');
  });

  it('does NOT surface it without an adapter — there is no host fallback', async () => {
    const { createSession } = await import('../assembly/create-session.js');

    createSession({
      config: baseConfig(),
      context: { agentsMd: '', projectNotesMd: '' },
      terminal: MOCK_TERMINAL,
      provider: createMockProvider(),
    });

    const names = toolNamesOf(sessionCtorCalls[0]!);
    // Both halves: the tool is absent, AND the list is genuinely populated — a `not.toContain` over
    // an empty list passes for the wrong reason, which is how a negative assertion goes vacuous.
    expect(names.length).toBeGreaterThan(3);
    expect(names).not.toContain('CodebaseRetrieval');
  });
});

describe('ARCH-013 stage 3 — the PUBLIC surface carries both ports (this is what guards the fix)', () => {
  beforeEach(() => {
    sessionCtorCalls.length = 0;
  });

  /**
   * Everything `initializeInteractiveSessionAsync` needs that is not under test. Review drove this
   * entry point and found the fields dropped at the ~40-field hand-map inside it — a hop ABOVE the
   * projection the first commit fixed, so every `createSession`-level case passed on the pre-fix tree
   * while a consumer still got silence.
   */
  function asyncInitDeps(): Parameters<
    typeof import('../interactive/interactive-session-init.js').initializeInteractiveSessionAsync
  >[1] {
    return {
      sandboxSnapshotId: undefined,
      resumeSessionId: undefined,
      pendingRestoreMessages: null,
      permissionHandler: undefined,
      askHandler: undefined,
      onTextDelta: () => {},
      onContextUpdate: () => {},
      onCompactEvent: () => {},
      onToolExecution: () => {},
      executeModelCommand: () => Promise.resolve(null),
      isModelCommandInvocable: () => false,
      commandDescriptors: [],
      commandSemanticRoles: undefined,
      setEditCheckpointStore: () => {},
    } as never;
  }

  it('carries a guardrail registry set on the published option type all the way to the session', async () => {
    const { initializeInteractiveSessionAsync } =
      await import('../interactive/interactive-session-init.js');

    await initializeInteractiveSessionAsync(
      {
        cwd: '/arch-013-stage-3-public',
        provider: createMockProvider(),
        bare: true,
        config: baseConfig(),
        guardrails: { neverPasses: NEVER_PASSES },
      },
      asyncInitDeps(),
    );

    expect(sessionCtorCalls).toHaveLength(1);
    expect(guardrailHooksOf(sessionCtorCalls[0]!)).toHaveLength(1);
    expect(executorTypesOf(sessionCtorCalls[0]!)).toContain('guardrail');
  });

  it('carries a retrieval adapter set on the published option type through to the tool surface', async () => {
    const { initializeInteractiveSessionAsync } =
      await import('../interactive/interactive-session-init.js');
    const retrievalAdapter: IRetrievalAdapter = {
      retrieve: async () => ({ symbols: [], totalTokens: 0 }),
    };

    await initializeInteractiveSessionAsync(
      {
        cwd: '/arch-013-stage-3-public',
        provider: createMockProvider(),
        bare: true,
        config: baseConfig(),
        retrievalAdapter,
      },
      asyncInitDeps(),
    );

    const names = toolNamesOf(sessionCtorCalls[0]!);
    expect(names.length).toBeGreaterThan(3);
    expect(names).toContain('CodebaseRetrieval');
  });

  it('carries neither when neither is set — the contrast that makes the two above mean something', async () => {
    const { initializeInteractiveSessionAsync } =
      await import('../interactive/interactive-session-init.js');

    await initializeInteractiveSessionAsync(
      {
        cwd: '/arch-013-stage-3-public',
        provider: createMockProvider(),
        bare: true,
        config: baseConfig(),
      },
      asyncInitDeps(),
    );

    expect(guardrailHooksOf(sessionCtorCalls[0]!)).toHaveLength(0);
    const names = toolNamesOf(sessionCtorCalls[0]!);
    // Populated-list guard, like its siblings: a `not.toContain` over an empty list passes for the
    // wrong reason, and this file argues that everywhere else.
    expect(names.length).toBeGreaterThan(3);
    expect(names).not.toContain('CodebaseRetrieval');
  });
});

describe('ARCH-013 stage 3 — the ports are pinned to the PUBLISHED construction type', () => {
  it('accepts both ports on `IInteractiveSessionStandardOptions` itself', () => {
    // WHAT THIS ADDS, stated narrowly because an earlier docblock here claimed more than it does.
    //
    // The one guard distinct to this case: both ports are pinned to the PUBLISHED construction type
    // independently of `initializeInteractiveSessionAsync`'s parameter type. Everything else that
    // could fail here already fails elsewhere — review measured that of the five typecheck errors
    // produced by removing a port, three come from other sites that would break anyway.
    //
    // It is enforced by `pnpm typecheck`, never by `vitest`, which is unlike every other case in this
    // file. The runtime expectations below are incidental; the annotation is the assertion.
    //
    // An earlier revision also wrote `const seamOptions: TInteractiveSessionOptions = options` and
    // asserted `toBe(options)`. That is a widening that cannot fail once the annotation above holds,
    // followed by a tautology — the same shape as the `as never` this case started with, which is
    // what makes it worth deleting rather than keeping as belt-and-braces.
    //
    // NOT proven here: that a value set this way arrives. `new InteractiveSession(...)` initialises
    // asynchronously with no public await point, and driving it to completion needs a Session double
    // far past this fixture. The next hop is `interactive-session.ts:341-342`, a straight
    // pass-through into `initializeInteractiveSessionAsync` — which the group above drives directly
    // and red-proves. Two readers checked that pass-through by hand; it is the one link in this file
    // carried by review rather than by execution.
    const options: IInteractiveSessionStandardOptions = {
      cwd: '/arch-013-stage-3-seam',
      provider: createMockProvider(),
      bare: true,
      config: baseConfig(),
      guardrails: { neverPasses: NEVER_PASSES },
      retrievalAdapter: { retrieve: async () => ({ symbols: [], totalTokens: 0 }) },
    };

    expect(options.guardrails).toBeDefined();
    expect(options.retrievalAdapter).toBeDefined();
  });
});
