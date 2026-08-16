import { describe, expect, it } from 'vitest';

import { createRobotaPacks } from '../robota-profile.js';
import {
  assertChildProcessSubagentsCanReproduce,
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
