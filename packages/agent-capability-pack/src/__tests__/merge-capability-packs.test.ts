import { FunctionTool } from '@robota-sdk/agent-core';
import { describe, expect, it } from 'vitest';

import { mergeCapabilityPacks } from '../merge-capability-packs.js';

import type { ICapabilityPack } from '../capability-pack-types.js';
import type { IAgentDefinition, ICommandModule } from '@robota-sdk/agent-framework';

/**
 * ARCH-005 S1 — `mergeCapabilityPacks` is the additive analog of `resolvePreset`: a PURE, deterministic
 * fold that produces the `baseCommandModules ⊕ pack` superset and a `{ merged, rejected }` result. It never
 * silently overrides a colliding id (mirrors `IPresetRegistrationResult`).
 */

function commandModule(name: string): ICommandModule {
  return { name };
}

function tool(name: string): FunctionTool {
  return new FunctionTool(
    { name, description: `tool ${name}`, parameters: { type: 'object', properties: {} } },
    async () => ({ success: true }),
  );
}

function subagent(name: string): IAgentDefinition {
  return { name, description: `agent ${name}`, systemPrompt: 'you are a test agent' };
}

describe('mergeCapabilityPacks — additive merge', () => {
  it('contributes a pack command module on top of the base modules', () => {
    const base = [commandModule('shell')];
    const pack: ICapabilityPack = { id: 'p1', commandModules: [commandModule('jira')] };

    const result = mergeCapabilityPacks(base, [pack]);

    expect(result.merged.commandModules.map((m) => m.name)).toEqual(['shell', 'jira']);
    expect(result.rejected).toEqual([]);
  });

  it('contributes pack tools and subagents additively', () => {
    const pack: ICapabilityPack = {
      id: 'p1',
      tools: [tool('Glob'), tool('Grep')],
      subagents: [subagent('Explore')],
    };

    const result = mergeCapabilityPacks([], [pack]);

    expect(result.merged.tools.map((t) => t.getName())).toEqual(['Glob', 'Grep']);
    expect(result.merged.subagents.map((a) => a.name)).toEqual(['Explore']);
  });

  it('preserves profile order across multiple packs (deterministic precedence)', () => {
    const packA: ICapabilityPack = { id: 'a', commandModules: [commandModule('a1')] };
    const packB: ICapabilityPack = { id: 'b', commandModules: [commandModule('b1')] };

    const result = mergeCapabilityPacks([commandModule('base')], [packA, packB]);

    expect(result.merged.commandModules.map((m) => m.name)).toEqual(['base', 'a1', 'b1']);
  });
});

describe('mergeCapabilityPacks — conflict rejection channel (R5)', () => {
  it('rejects a pack command module colliding with a base module — never silently overrides', () => {
    const base = [commandModule('shell')];
    const collidingBaseModule = { name: 'shell', tag: 'from-pack' } as unknown as ICommandModule;
    const pack: ICapabilityPack = { id: 'p1', commandModules: [collidingBaseModule] };

    const result = mergeCapabilityPacks(base, [pack]);

    // Base module wins; the colliding pack module is NOT in the merged set.
    expect(result.merged.commandModules).toHaveLength(1);
    expect(result.merged.commandModules[0]).toBe(base[0]);
    expect(result.rejected).toContainEqual({
      kind: 'commandModule',
      id: 'shell',
      reason: 'collides with base command module',
    });
  });

  it('rejects a later pack id duplicating an earlier pack id (first registration wins)', () => {
    const packA: ICapabilityPack = { id: 'a', commandModules: [commandModule('dup')] };
    const packB: ICapabilityPack = { id: 'b', commandModules: [commandModule('dup')] };

    const result = mergeCapabilityPacks([], [packA, packB]);

    expect(result.merged.commandModules.map((m) => m.name)).toEqual(['dup']);
    expect(result.merged.commandModules[0]).toBe(packA.commandModules?.[0]);
    expect(result.rejected).toContainEqual({
      kind: 'commandModule',
      id: 'dup',
      reason: 'duplicate commandModule id',
    });
  });

  it('rejects colliding tool names and subagent ids with a reason, keeping the first', () => {
    const packA: ICapabilityPack = {
      id: 'a',
      tools: [tool('Read')],
      subagents: [subagent('Plan')],
    };
    const packB: ICapabilityPack = {
      id: 'b',
      tools: [tool('Read')],
      subagents: [subagent('Plan')],
    };

    const result = mergeCapabilityPacks([], [packA, packB]);

    expect(result.merged.tools.map((t) => t.getName())).toEqual(['Read']);
    expect(result.merged.subagents.map((a) => a.name)).toEqual(['Plan']);
    expect(result.rejected).toContainEqual({
      kind: 'tool',
      id: 'Read',
      reason: 'duplicate tool id',
    });
    expect(result.rejected).toContainEqual({
      kind: 'subagent',
      id: 'Plan',
      reason: 'duplicate subagent id',
    });
  });

  it('is pure — does not mutate its inputs', () => {
    const base = [commandModule('shell')];
    const pack: ICapabilityPack = { id: 'p1', commandModules: [commandModule('jira')] };

    mergeCapabilityPacks(base, [pack]);

    expect(base).toHaveLength(1);
    expect(pack.commandModules).toHaveLength(1);
  });
});
