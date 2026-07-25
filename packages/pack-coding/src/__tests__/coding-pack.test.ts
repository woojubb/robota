import { mergeCapabilityPacks } from '@robota-sdk/agent-capability-pack';
import { BUILT_IN_AGENTS, createDefaultTools } from '@robota-sdk/agent-framework';
import { describe, expect, it } from 'vitest';

import { codingPack } from '../coding-pack.js';

/**
 * ARCH-005 S1 — `@robota-sdk/pack-coding` is the additive-axis proof: an `ICapabilityPack` that bundles
 * EXACTLY robota's current coding toolset (the built-in tools), the coding command modules, and the coding
 * subagents. The tool assertion is pinned to `createDefaultTools()` so the pack cannot drift from robota's
 * actual default toolset — adding a default tool fails this test until the pack is updated.
 */

describe('codingPack — contributes exactly robota\'s current coding toolset', () => {
  it('bundles the same tools (by name) that robota\'s createDefaultTools() ships by default', () => {
    // No adapters supplied → the always-present coding toolset (retrieval/computer are adapter-gated, absent).
    const defaultToolNames = createDefaultTools().map((tool) => tool.getName());
    const packToolNames = (codingPack.tools ?? []).map((tool) => tool.getName());

    expect(packToolNames).toEqual(defaultToolNames);
  });

  it('bundles robota\'s built-in coding subagents', () => {
    const packSubagentNames = (codingPack.subagents ?? []).map((agent) => agent.name);
    expect(packSubagentNames).toEqual(BUILT_IN_AGENTS.map((agent) => agent.name));
    // The documented default three.
    expect(packSubagentNames).toEqual(['general-purpose', 'Explore', 'Plan']);
  });

  it('bundles the coding command modules (shell + editor)', () => {
    const packModuleNames = (codingPack.commandModules ?? []).map((module) => module.name);
    expect(packModuleNames).toEqual(['agent-command-shell', 'agent-command-editor']);
  });

  it('has a stable pack id', () => {
    expect(codingPack.id).toBe('coding');
  });
});

describe('codingPack — is a well-formed additive pack', () => {
  it('merges cleanly on top of empty base modules with no rejections', () => {
    const { merged, rejected } = mergeCapabilityPacks([], [codingPack]);

    expect(rejected).toEqual([]);
    expect(merged.commandModules.map((m) => m.name)).toEqual([
      'agent-command-shell',
      'agent-command-editor',
    ]);
    expect(merged.tools.length).toBeGreaterThan(0);
    expect(merged.subagents.map((a) => a.name)).toContain('Explore');
  });
});
