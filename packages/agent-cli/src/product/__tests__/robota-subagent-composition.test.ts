import { describe, expect, it } from 'vitest';

import { createRobotaPacks } from '../robota-profile.js';
import {
  assertChildProcessSubagentsCanReproduce,
  createRobotaPackSet,
  createRobotaSubagentComposition,
  nonReproducibleCapabilities,
  packTools,
  type IRobotaPackContext,
} from '../robota-subagent-composition.js';

import type { IToolWithEventService } from '@robota-sdk/agent-core';

const CWD = '/tmp/robota-arch-021';

/** A stand-in for a live, unrepeatable handle. Its shape is irrelevant — its presence is the point. */
const SANDBOX_CLIENT = {} as IRobotaPackContext['sandboxClient'];

function toolNames(tools: readonly { schema: { name: string } }[]): string[] {
  return tools.map((tool) => tool.schema.name).sort();
}

/**
 * A pack contributing a tool NO default tier contains. This is the discriminator: robota's own packs
 * mirror `createDefaultTools()` by name (`pack-coding` is pinned to that set by its own test), so
 * comparing robota's two name sets passes whether the child composes from packs or from imported
 * defaults — a check that cannot fail on the defect it names. A uniquely-named pack tool can.
 */
const UNIQUE_TOOL_NAME = 'arch021UniquelyNamedPackTool';

function createScratchPacks(context: IRobotaPackContext): ReturnType<typeof createRobotaPacks> {
  const tool = {
    schema: { name: UNIQUE_TOOL_NAME, description: 'scratch', parameters: {} },
    execute: () => Promise.resolve({ success: true, data: context.cwd }),
  } as unknown as IToolWithEventService;
  return [{ name: 'scratch-pack', tools: [tool] }] as unknown as ReturnType<
    typeof createRobotaPacks
  >;
}

describe('ARCH-021 — robota composes its own child-process subagents', () => {
  it('TC-05: a pack tool outside the default mirror reaches the child composition', () => {
    // Red against the pre-ARCH-021 behaviour: a child built from `createDefaultTools()` cannot
    // contain this name, because no default tier contributes it.
    const composition = createRobotaSubagentComposition(createScratchPacks);

    expect(toolNames(composition.createTools({ cwd: CWD }))).toEqual([UNIQUE_TOOL_NAME]);
  });

  it('TC-05: dropping a pack drops its tools from the child (ARCH-006, in the child too)', () => {
    // The invariant that was true in the parent and false in the child. With imported defaults the
    // child's surface is independent of the pack set, so an empty pack list would still yield tools.
    const composition = createRobotaSubagentComposition(() => []);

    expect(composition.createTools({ cwd: CWD })).toEqual([]);
  });

  it('TC-05: the worker composition and the parent composition read one expression', () => {
    const parentNames = toolNames(
      createRobotaPacks({ cwd: CWD }).flatMap((p) => [...(p.tools ?? [])]),
    );
    const childNames = toolNames(createRobotaSubagentComposition().createTools({ cwd: CWD }));

    expect(childNames).toEqual(parentNames);
    expect(childNames.length).toBeGreaterThan(0);
  });

  it('TC-05: the composition binds tools to the cwd it is given, not to a captured one', () => {
    // ARCH-010: a child that inherited the parent's root read outside its own worktree. The root
    // travels through the call for exactly that reason.
    const composition = createRobotaSubagentComposition();

    const here = composition.createTools({ cwd: CWD });
    const there = composition.createTools({ cwd: `${CWD}-other` });

    expect(there).not.toBe(here);
    expect(toolNames(there)).toEqual(toolNames(here));
  });

  it('carries robota provider definitions, so a child resolves what the parent resolves', () => {
    const { providerDefinitions } = createRobotaSubagentComposition();

    expect(providerDefinitions.length).toBeGreaterThan(0);
    // `type` is the field `createProviderFromProfile` matches on — the one that threw
    // `Unknown provider` in the child while the parent resolved it fine.
    expect(providerDefinitions.map((definition) => definition.type)).toContain('openai');
  });

  it('TC-06: refuses child-process subagents when the parent composed a sandbox client', () => {
    const context: IRobotaPackContext = { cwd: CWD, sandboxClient: SANDBOX_CLIENT };

    expect(nonReproducibleCapabilities(context)).toEqual(['sandboxClient']);
    expect(() => assertChildProcessSubagentsCanReproduce(context)).toThrow(/sandboxClient/);
    // Fail CLOSED, and say why: a silently-dropped sandbox is a sandboxed parent with a host-tool
    // child, which is ARCH-010's measured shape.
    expect(() => assertChildProcessSubagentsCanReproduce(context)).toThrow(/ARCH-033/);
  });

  it('TC-06: allows child-process subagents for the composition robota actually ships', () => {
    // Robota supplies no sandbox client today, so the guard must not block the live path — it binds
    // the moment one is added, which is the reason it exists.
    expect(nonReproducibleCapabilities({ cwd: CWD })).toEqual([]);
    expect(() => assertChildProcessSubagentsCanReproduce({ cwd: CWD })).not.toThrow();
  });

  it('packTools is the one expression both processes read', () => {
    expect(toolNames(packTools({ cwd: CWD }))).toEqual(
      toolNames(createRobotaSubagentComposition().createTools({ cwd: CWD })),
    );
  });
});

describe('ARCH-033 — the guard runs on the real composition path, not just in its own test', () => {
  it('refuses to compose a pack set when a capability the child cannot reproduce is present', () => {
    // The reason this case exists: `assertChildProcessSubagentsCanReproduce` was exported,
    // unit-tested and called by NOTHING. Calling it directly (as the cases above do) proves the
    // function works; it does not prove the product ever asks. This asserts through
    // `createRobotaPackSet`, which is what `cli.ts` actually calls, so deleting the guard's call site
    // turns this red while the direct-call cases above stay green.
    // A minimal stand-in rather than a real client: the guard asks whether the capability is
    // PRESENT, never what it does, and `agent-cli` takes no dependency on `agent-tools`.
    const sandboxClient = {
      run: async () => ({ stdout: '', stderr: '', exitCode: 0 }),
      readFile: async () => '',
      writeFile: async () => {},
    } as IRobotaPackContext['sandboxClient'];

    expect(() => createRobotaPackSet(CWD, { sandboxClient })).toThrow(/sandboxClient/);
  });

  it('composes normally when every capability is reproducible', () => {
    expect(() => createRobotaPackSet(CWD)).not.toThrow();
  });
});

describe('ARCH-033 — a projectable sandbox is no longer a refusal', () => {
  /** A client that can produce a snapshot reference — the half the parent contributes. */
  const projectableClient = {
    run: async () => ({ stdout: '', stderr: '', exitCode: 0 }),
    readFile: async () => '',
    writeFile: async () => {},
    snapshot: async () => 'snap-1',
    restore: async () => {},
  } as IRobotaPackContext['sandboxClient'];

  /** A client that cannot: `snapshot()` is optional on the contract, and this one omits it. */
  const unprojectableClient = {
    run: async () => ({ stdout: '', stderr: '', exitCode: 0 }),
    readFile: async () => '',
    writeFile: async () => {},
  } as IRobotaPackContext['sandboxClient'];

  it('composes when the sandbox can be snapshotted AND its type is named', () => {
    // This is the item's whole point: the refusal was never about sandboxes being forbidden, it was
    // about the child having no way to rebuild one. Give it both halves and there is nothing to
    // refuse.
    expect(() =>
      createRobotaPackSet(CWD, { sandboxClient: projectableClient, sandboxType: 'e2b' }),
    ).not.toThrow();
  });

  it('still refuses when the type is unnamed — a snapshot nothing knows how to open', () => {
    expect(() => createRobotaPackSet(CWD, { sandboxClient: projectableClient })).toThrow(
      /sandboxClient/,
    );
  });

  it('still refuses when the client cannot snapshot, however well-named its type', () => {
    // `snapshot()` is optional on `ISandboxClient`. A registered factory with no reference to hand it
    // would rebuild an EMPTY sandbox — a child that looks sandboxed while sharing none of the
    // parent's state, which is worse than refusing.
    expect(() =>
      createRobotaPackSet(CWD, { sandboxClient: unprojectableClient, sandboxType: 'e2b' }),
    ).toThrow(/sandboxClient/);
  });
});

describe('ARCH-034 — the runner choice is packaging, not capability', () => {
  it('gives a child-process subagent the goal tool when the parent session had it', () => {
    // In-process subagents receive the parent's fully ASSEMBLED surface, which includes the goal tool
    // when `includeGoalTool` is set. The child rebuilds the product's set at its own root, and the
    // goal tool is added by session assembly rather than by any pack — so before this it was missing
    // from one runner and present in the other, silently, because both paths succeed.
    const composition = createRobotaSubagentComposition();

    const withTier = composition
      .createTools({ cwd: CWD, sessionTiers: { includeGoalTool: true } })
      .map((tool) => tool.getName());

    expect(withTier).toContain('report_goal_status');
  });

  it('omits it when the parent session did not, rather than adding it unconditionally', () => {
    // Parity means MATCHING the parent, not maximising. A child that always got the goal tool would
    // diverge from an in-process sibling in the other direction.
    const composition = createRobotaSubagentComposition();

    expect(composition.createTools({ cwd: CWD }).map((tool) => tool.getName())).not.toContain(
      'report_goal_status',
    );
    expect(
      composition
        .createTools({ cwd: CWD, sessionTiers: { includeGoalTool: false } })
        .map((tool) => tool.getName()),
    ).not.toContain('report_goal_status');
  });

  it('leaves the pack tools identical either way — only the tier differs', () => {
    const composition = createRobotaSubagentComposition();
    const base = composition.createTools({ cwd: CWD }).map((tool) => tool.getName());
    const withTier = composition
      .createTools({ cwd: CWD, sessionTiers: { includeGoalTool: true } })
      .map((tool) => tool.getName());

    expect(withTier.filter((name) => name !== 'report_goal_status')).toEqual(base);
  });
});
