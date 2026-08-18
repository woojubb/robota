import { mergeCapabilityPacks } from '@robota-sdk/agent-capability-pack';
import { BUILT_IN_AGENTS } from '@robota-sdk/agent-framework';
import { createDefaultTools } from '@robota-sdk/agent-tool-defaults';
import { describe, expect, it } from 'vitest';

import { createCodingPack } from '../coding-pack.js';

/**
 * ARCH-005 S1 — `@robota-sdk/pack-coding` is the additive-axis proof: an `ICapabilityPack` that bundles
 * EXACTLY robota's current coding toolset (the built-in tools), the coding command modules, and the coding
 * subagents. The tool assertion is pinned to `createDefaultTools()` so the pack cannot drift from robota's
 * actual default toolset — adding a default tool fails this test until the pack is updated.
 *
 * ARCH-006 — the pack is built by a FACTORY that takes the session's working directory, because a pack
 * whose file tools are constructed with no `cwd` carries a DISARMED working-directory path guard
 * (`checkPathWithinCwd` is a no-op when `cwd` is undefined). Once a product can hand the whole tool surface
 * to its packs (`defaultTools: []`), that would be an unsandboxed `Read`/`Write`/`Edit`. The sandbox
 * property is asserted directly below, not assumed.
 */

const CWD = '/tmp/pack-coding-scope';
/** The minimal execution context the built-in file tools read — typed structurally so this package needs
 * no `@robota-sdk/agent-core` dependency just to run its own tools. */
const TOOL_CONTEXT = { toolName: 'Read', parameters: {} };

/** Run a tool and unwrap the inner `IToolInvocationResult` the built-in file tools return as JSON. */
async function invoke(
  pack: ReturnType<typeof createCodingPack>,
  name: string,
  parameters: Record<string, unknown>,
): Promise<{ success: boolean; error?: string }> {
  const tool = (pack.tools ?? []).find((candidate) => candidate.getName() === name);
  if (!tool) throw new Error(`pack does not contribute a ${name} tool`);
  const outcome = await tool.execute(parameters as never, TOOL_CONTEXT as never);
  return JSON.parse(String((outcome as { data?: unknown }).data)) as {
    success: boolean;
    error?: string;
  };
}

describe("codingPack — contributes exactly robota's current coding toolset", () => {
  it("bundles the same tools (by name) that robota's createDefaultTools() ships by default", () => {
    // No adapters supplied → the always-present coding toolset (retrieval/computer are adapter-gated, absent).
    // ARCH-010 — `createDefaultTools` now requires the root. It is `CWD`, the same root the pack under
    // test is built with, so the two sides of this comparison are assembled alike; only NAMES are read.
    const defaultToolNames = createDefaultTools({ cwd: CWD }).map((tool) => tool.getName());
    const packToolNames = (createCodingPack({ cwd: CWD }).tools ?? []).map((tool) =>
      tool.getName(),
    );

    expect(packToolNames).toEqual(defaultToolNames);
  });

  it("bundles robota's built-in coding subagents", () => {
    const packSubagentNames = (createCodingPack({ cwd: CWD }).subagents ?? []).map(
      (agent) => agent.name,
    );
    expect(packSubagentNames).toEqual(BUILT_IN_AGENTS.map((agent) => agent.name));
    // The documented default three.
    expect(packSubagentNames).toEqual(['general-purpose', 'Explore', 'Plan']);
  });

  it('bundles the coding command modules (shell + editor)', () => {
    const packModuleNames = (createCodingPack({ cwd: CWD }).commandModules ?? []).map(
      (module) => module.name,
    );
    expect(packModuleNames).toEqual(['agent-command-shell', 'agent-command-editor']);
  });

  it('has a stable pack id', () => {
    expect(createCodingPack({ cwd: CWD }).id).toBe('coding');
  });
});

describe('codingPack — the file tools are SCOPED to the supplied cwd (ARCH-006)', () => {
  it('DENIES a Read outside the working directory', async () => {
    const result = await invoke(createCodingPack({ cwd: CWD }), 'Read', {
      filePath: '/etc/hostname',
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('outside the working directory');
  });

  it('DENIES a Write outside the working directory', async () => {
    const result = await invoke(createCodingPack({ cwd: CWD }), 'Write', {
      filePath: '/etc/pack-coding-should-never-write',
      content: 'nope',
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('outside the working directory');
  });

  it('DENIES an Edit outside the working directory', async () => {
    const result = await invoke(createCodingPack({ cwd: CWD }), 'Edit', {
      filePath: '/etc/hostname',
      oldString: 'a',
      newString: 'b',
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('outside the working directory');
  });

  // SEC-007 — the reachability floor. Glob and Grep were registered as MODULE-LEVEL SINGLETONS here,
  // which are context-free by construction: this pack made `cwd` required so the file-tool guard
  // could not be disarmed by omission, and then contributed two tools that could enumerate (and, in
  // Grep's `content` mode, READ) anywhere on the host. Asserting the containment through the PACK,
  // not through the tool factory, is what pins that the fix is actually wired up.
  it('DENIES a Glob rooted outside the working directory (SEC-007)', async () => {
    const result = await invoke(createCodingPack({ cwd: CWD }), 'Glob', {
      pattern: '*',
      path: '/etc',
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('outside the working directory');
  });

  it('DENIES a Grep rooted outside the working directory (SEC-007)', async () => {
    const result = await invoke(createCodingPack({ cwd: CWD }), 'Grep', {
      pattern: 'root',
      path: '/etc',
      outputMode: 'content',
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('outside the working directory');
  });

  it('scopes each pack instance to ITS OWN cwd — two packs do not share a scope', async () => {
    const other = await invoke(createCodingPack({ cwd: '/tmp/pack-coding-other' }), 'Read', {
      filePath: `${CWD}/inside.txt`,
    });

    // Outside the OTHER pack's root, so denied — the scope travels with the instance, not the module.
    expect(other.success).toBe(false);
    expect(other.error).toContain('outside the working directory');
  });
});

describe('codingPack — is a well-formed additive pack', () => {
  it('merges cleanly on top of empty base modules with no rejections', () => {
    const { merged, rejected } = mergeCapabilityPacks([], [createCodingPack({ cwd: CWD })]);

    expect(rejected).toEqual([]);
    expect(merged.commandModules.map((m) => m.name)).toEqual([
      'agent-command-shell',
      'agent-command-editor',
    ]);
    expect(merged.tools.length).toBeGreaterThan(0);
    expect(merged.subagents.map((a) => a.name)).toContain('Explore');
  });
});
