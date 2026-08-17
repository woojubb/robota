/**
 * ARCH-013 stage 3 — a supplied guardrail registry actually reaches the assembled session.
 *
 * The stage-3 projection test proves the registry survives `IInitOptions → ICreateSessionOptions`.
 * That is a type-level hop, and on its own it would let this change claim a capability it had not
 * restored: a projection can carry a field into an option bag that then drops it again.
 *
 * This is the other half, asserted on the ASSEMBLED session rather than on the option bag. The
 * property that matters is the one `create-session.ts` documents in its own comment — registering a
 * registry only adds the EXECUTOR, and the guardrails fire only if a `{ type: 'guardrail' }` hook
 * definition exists on an enforcing event, so `createSession` auto-injects a `PreToolUse` group when
 * the config declares none. Nothing had ever tested that from the option in: `guardrails` appeared in
 * no `createSession` test before this one.
 *
 * It also pins the idempotence half — a consumer who declares their own guardrail hook must not get a
 * second, auto-injected one — because that branch is what makes the auto-injection safe to ship.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

import type { IResolvedConfig } from '../config/config-types.js';
import type { TGuardrail } from '@robota-sdk/agent-core';

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

/** Tool names on the assembled session. */
function toolNamesOf(sessionOptions: Record<string, unknown>): string[] {
  const tools = (sessionOptions.tools ?? []) as Array<{ getName?: () => string }>;
  return tools.map((tool) => tool.getName?.() ?? '').filter(Boolean);
}

describe('ARCH-013 stage 3 — a supplied guardrail registry reaches the assembled session', () => {
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

describe('ARCH-013 stage 3 — a supplied retrieval adapter reaches the assembled tool surface', () => {
  beforeEach(() => {
    sessionCtorCalls.length = 0;
  });

  it('surfaces CodebaseRetrieval when an adapter is supplied', async () => {
    // `create-tools.test.ts` already covers the last hop (adapter in `createDefaultTools`'s options →
    // tool present). The hop nothing covered is this one: `createSession` → `assemble-session-tools`
    // → `createDefaultTools`. Without it, "the adapter reaches the session" was an inference across
    // two separately-tested halves rather than a measured fact.
    const { createSession } = await import('../assembly/create-session.js');
    const retrievalAdapter = {
      search: () => Promise.resolve([]),
    } as unknown as Parameters<typeof createSession>[0]['retrievalAdapter'];

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
