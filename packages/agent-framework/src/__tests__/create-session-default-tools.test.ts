/**
 * ARCH-006 — the capability-pack TOOL axis at parity with the command and subagent axes.
 *
 * Before this change `createSession` assembled `[...createDefaultTools(), ...additionalTools]` with NO
 * dedupe and NO suppression hook, so:
 *
 *  - a contributor whose tool NAME matched a framework default was listed TWICE, and
 *  - no consumer could remove or replace a framework default at all.
 *
 * Two scoped additive seams close that, mirroring the adjacent NEUT-003 / ARCH-005 subagent precedent:
 *
 *  - `defaultTools` REPLACES the framework's `createDefaultTools()` tier (`[]` suppresses it entirely),
 *    exactly as NEUT-003's `builtInAgents` replaces `BUILT_IN_AGENTS`;
 *  - the assembled list is deduped BY TOOL NAME, first occurrence wins, over the fixed tier order
 *    `defaultTier ⊕ additionalTools ⊕ goalTool` — the same "first entry for a name wins" rule
 *    `AgentDefinitionLoader` already applies within the built-in tier.
 *
 * Absent `defaultTools` and absent a duplicate name, every existing path is byte-identical.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

import type { IResolvedConfig } from '../config/config-types.js';
import type { IToolWithEventService } from '@robota-sdk/agent-core';

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
    chat: vi.fn().mockResolvedValue({
      role: 'assistant',
      content: 'mock response',
      timestamp: new Date(),
    }),
  } as never;
}

function baseConfig(): IResolvedConfig {
  return {
    defaultTrustLevel: 'moderate' as const,
    provider: { name: 'mock', apiKey: 'test-key', model: 'test-model' },
    permissions: { allow: [], deny: [] },
    language: 'en' as const,
    env: {},
  };
}

/** A minimal named tool double — the shape `additionalTools` / `defaultTools` accept. */
function namedTool(name: string, marker: string): IToolWithEventService {
  return {
    schema: { name, description: marker, parameters: { type: 'object', properties: {} } },
    setEventService: () => {},
    execute: async () => ({ success: true, data: marker }),
    validate: () => true,
    validateParameters: () => ({ isValid: true, errors: [], warnings: [] }),
    getDescription: () => marker,
    getName: () => name,
  } as unknown as IToolWithEventService;
}

async function assembleToolNames(
  overrides: Record<string, unknown> = {},
): Promise<{ names: string[]; tools: IToolWithEventService[] }> {
  const { createSession } = await import('../assembly/create-session.js');
  // ARCH-035 made `createSession` async: the default tier is reached by dynamic import now, so the
  // session is not constructed until that resolves. Without this await the ctor-call spy below reads
  // an empty array and every case here reports "no tools" as if the tier had vanished.
  await createSession({
    config: baseConfig(),
    context: { agentsMd: '', projectNotesMd: '' },
    terminal: MOCK_TERMINAL,
    provider: createMockProvider(),
    ...overrides,
  } as never);
  const tools = sessionCtorCalls[0]!.tools as IToolWithEventService[];
  return { names: tools.map((t) => t.getName()), tools };
}

describe('ARCH-006 — additionalTools dedupe by tool name', () => {
  beforeEach(() => {
    sessionCtorCalls.length = 0;
  });

  it('lists a name-colliding contributed tool ONCE, not twice', async () => {
    const { names } = await assembleToolNames({
      additionalTools: [namedTool('Read', 'contributed-Read')],
    });

    expect(names.filter((n) => n === 'Read')).toHaveLength(1);
  });

  it('keeps the FIRST occurrence of a name — the framework default wins over a collider', async () => {
    // Precedence is deliberate and documented: the default tier is constructed WITH the session context
    // (cwd → the working-directory path guard, sandboxClient, retrieval adapter), so a context-free
    // contributed instance must never silently displace it. Replacement is expressible, but only through
    // the EXPLICIT `defaultTools` seam below — never as a side effect of a name collision.
    const { tools } = await assembleToolNames({
      additionalTools: [namedTool('Read', 'contributed-Read')],
    });

    const read = tools.find((t) => t.getName() === 'Read')!;
    expect(read.getDescription()).not.toBe('contributed-Read');
  });

  it('still admits a contributed tool whose name is NEW (the axis stays additive)', async () => {
    const { names } = await assembleToolNames({
      additionalTools: [namedTool('AcmeTicketLookup', 'new')],
    });

    expect(names).toContain('AcmeTicketLookup');
  });

  it('is byte-identical when no name collides (unchanged order: defaults, then additional)', async () => {
    const { createDefaultTools } = await import('@robota-sdk/agent-tool-defaults');
    const { names } = await assembleToolNames({
      additionalTools: [namedTool('AcmeTicketLookup', 'new')],
    });

    // ARCH-010 — `createDefaultTools` now requires the root. `process.cwd()` is the root the assembled
    // session under test uses (`createSession` resolves `options.cwd ?? process.cwd()`), so the two
    // sides of this comparison are built the same way; only tool NAMES are read from either.
    expect(names).toEqual([
      ...createDefaultTools({ cwd: process.cwd() }).map((t) => t.getName()),
      'AcmeTicketLookup',
    ]);
  });
});

describe('ARCH-006 — the injectable/suppressible default tool tier', () => {
  beforeEach(() => {
    sessionCtorCalls.length = 0;
  });

  it('SUPPRESSES every framework default when `defaultTools: []` is injected', async () => {
    const { names } = await assembleToolNames({ defaultTools: [] });

    expect(names).toEqual([]);
  });

  it('lets a contributed pack OWN the whole tool surface (suppress + contribute)', async () => {
    // This is the shape a product profile uses to hand the tool axis to its capability packs: suppress the
    // framework tier, then let the packs supply every tool through `additionalTools`. Removing the pack
    // then genuinely removes its tools — the same load-bearing property the command and subagent axes have.
    const { names } = await assembleToolNames({
      defaultTools: [],
      additionalTools: [namedTool('Read', 'pack-Read'), namedTool('AcmeTicketLookup', 'pack-new')],
    });

    expect(names).toEqual(['Read', 'AcmeTicketLookup']);
  });

  it('REPLACES the framework tier with the injected set (NEUT-003 `builtInAgents` semantics)', async () => {
    const { names, tools } = await assembleToolNames({
      defaultTools: [namedTool('Read', 'injected-Read')],
    });

    expect(names).toEqual(['Read']);
    expect(tools[0]!.getDescription()).toBe('injected-Read');
  });

  it('leaves the framework tier exactly `createDefaultTools()` when the option is absent', async () => {
    const { createDefaultTools } = await import('@robota-sdk/agent-tool-defaults');
    const { names } = await assembleToolNames();

    // Same mirroring as above: the session resolves its root to `process.cwd()` when none is supplied.
    expect(names).toEqual(createDefaultTools({ cwd: process.cwd() }).map((t) => t.getName()));
  });
});

/** As `namedTool`, but declaring itself deferred — schemas withheld until loaded (CLI-1990). */
function deferredTool(name: string, marker: string): IToolWithEventService {
  const tool = namedTool(name, marker);
  return {
    ...tool,
    schema: { ...tool.schema, deferLoading: true },
  } as unknown as IToolWithEventService;
}

describe('CLI-1990 TC-11 — tool residency through session assembly', () => {
  beforeEach(() => {
    sessionCtorCalls.length = 0;
  });

  it('refuses a session in which every tool is deferred, naming the invariant', async () => {
    // The vendor's own 400 as a Robota-level error: a request that withholds every tool offers the
    // model nothing to call and nothing to search with.
    await expect(
      assembleToolNames({
        defaultTools: [],
        additionalTools: [deferredTool('a_tool', 'a'), deferredTool('b_tool', 'b')],
      }),
    ).rejects.toThrow('at least one tool must stay resident');
  });

  it('does NOT satisfy that invariant by quietly adding its own resident search tool', async () => {
    // The check runs over the DECLARED set, before the framework adds anything. Were it to run
    // after, an all-deferred configuration would silently acquire the one resident tool that
    // satisfies it and never be reported.
    await expect(
      assembleToolNames({ defaultTools: [], additionalTools: [deferredTool('only', 'only')] }),
    ).rejects.toThrow('all tools cannot be deferred');
  });

  it('adds the resident ToolSearch when a tool is deferred', async () => {
    const { names } = await assembleToolNames({
      defaultTools: [namedTool('Read', 'resident-Read')],
      additionalTools: [deferredTool('postgres_query', 'deferred')],
    });
    expect(names).toEqual(['Read', 'postgres_query', 'ToolSearch']);
  });

  it("adds NO search tool when nothing is deferred — today's sessions are unchanged", async () => {
    // The no-regression half: a session of resident tools gets exactly what it gets today, with no
    // eleventh tool appearing in a prompt that has nothing to load.
    const { names } = await assembleToolNames({
      defaultTools: [namedTool('Read', 'resident-Read')],
    });
    expect(names).toEqual(['Read']);
  });

  it('leaves the search tool itself resident — it is the way into the withheld catalog', async () => {
    const { tools } = await assembleToolNames({
      defaultTools: [namedTool('Read', 'resident-Read')],
      additionalTools: [deferredTool('postgres_query', 'deferred')],
    });
    const search = tools.find((tool) => tool.getName() === 'ToolSearch');
    expect(search?.schema.deferLoading).toBeUndefined();
  });

  it('preserves the residency flag of the entry that SURVIVES dedupe', async () => {
    // First occurrence wins, and it keeps its own marker: a deferred contributed tool colliding with
    // a resident default does not make the default deferred, and the reverse is equally true.
    const { tools } = await assembleToolNames({
      defaultTools: [namedTool('Read', 'resident-Read')],
      additionalTools: [
        deferredTool('Read', 'deferred-Read'),
        deferredTool('postgres_query', 'deferred'),
      ],
    });
    const read = tools.find((tool) => tool.getName() === 'Read');
    expect(read?.getDescription()).toBe('resident-Read');
    expect(read?.schema.deferLoading).toBeUndefined();
    expect(tools.find((tool) => tool.getName() === 'postgres_query')?.schema.deferLoading).toBe(
      true,
    );
  });

  it('keeps a surviving DEFERRED entry deferred when it wins the collision', async () => {
    const { tools } = await assembleToolNames({
      defaultTools: [deferredTool('Read', 'deferred-Read'), namedTool('Write', 'resident-Write')],
      additionalTools: [namedTool('Read', 'contributed-Read')],
    });
    const read = tools.find((tool) => tool.getName() === 'Read');
    expect(read?.getDescription()).toBe('deferred-Read');
    expect(read?.schema.deferLoading).toBe(true);
  });
});
