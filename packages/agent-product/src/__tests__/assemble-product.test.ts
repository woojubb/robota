import { FunctionTool } from '@robota-sdk/agent-core';
import { createScriptedProvider } from '@robota-sdk/agent-core/testing';
import { InteractiveSession } from '@robota-sdk/agent-framework';
import { getPreset, resolvePreset } from '@robota-sdk/agent-preset';
import { describe, expect, it } from 'vitest';

import { assembleProduct } from '../assemble-product.js';

import type { IProductProfile } from '../product-profile.js';
import type { IAIProvider } from '@robota-sdk/agent-core';
import type { IPreset } from '@robota-sdk/agent-preset';
import type { IAgentDefinition, ICommandModule } from '@robota-sdk/agent-framework';

/**
 * ARCH-005 S1 — `assembleProduct` is a PURE, deterministic, IO-free fold over `IProductProfile`. It
 * resolves presets via a per-call instance-scoped registry (R8), merges packs via `mergeCapabilityPacks`,
 * and delegates runtime construction to `agent-framework`'s `buildRuntimeSession` seam (R2) — it never
 * re-implements runtime assembly and never special-cases any product's id.
 */

function testProvider(): IAIProvider {
  return createScriptedProvider([{ text: 'ok' }]).provider;
}

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

describe('assembleProduct — capability fold', () => {
  it('folds base ⊕ pack command modules, pack tools, and pack subagents', () => {
    const profile: IProductProfile = {
      id: 'acme',
      provider: testProvider(),
      baseCommandModules: [commandModule('help')],
      packs: [
        {
          id: 'coding',
          commandModules: [commandModule('shell')],
          tools: [tool('Glob'), tool('Grep')],
          subagents: [subagent('Explore')],
        },
      ],
    };

    const product = assembleProduct(profile);

    expect(product.commandModules.map((m) => m.name)).toEqual(['help', 'shell']);
    expect(product.tools.map((t) => t.getName())).toEqual(['Glob', 'Grep']);
    expect(product.subagents.map((a) => a.name)).toEqual(['Explore']);
    expect(product.rejectedCapabilities).toEqual([]);
  });

  it('surfaces capability rejections from the merge (no silent override)', () => {
    const profile: IProductProfile = {
      id: 'acme',
      provider: testProvider(),
      baseCommandModules: [commandModule('shell')],
      packs: [{ id: 'p', commandModules: [commandModule('shell')] }],
    };

    const product = assembleProduct(profile);

    expect(product.commandModules.map((m) => m.name)).toEqual(['shell']);
    expect(product.rejectedCapabilities).toContainEqual({
      kind: 'commandModule',
      id: 'shell',
      reason: 'collides with base command module',
    });
  });
});

describe('assembleProduct — instance-scoped preset resolution (R8)', () => {
  const acmeReviewer: IPreset = {
    id: 'acme-reviewer',
    title: 'Acme Reviewer',
    description: 'strict review persona',
    persona: 'You are a meticulous code reviewer.',
    autonomy: 'ask-first',
  };

  it('resolves a profile preset via a per-call registry and honors defaultPresetId', () => {
    const profile: IProductProfile = {
      id: 'acme',
      provider: testProvider(),
      presets: [acmeReviewer],
      defaultPresetId: 'acme-reviewer',
    };

    const product = assembleProduct(profile);

    expect(product.resolvePreset('acme-reviewer').persona).toBe('You are a meticulous code reviewer.');
    expect(product.defaultPresetId).toBe('acme-reviewer');
    // built-ins remain reachable through the instance registry
    expect(product.presets.getPreset('default')).toBeDefined();
  });

  it('does NOT mutate the module-global preset registry (R8 — no cross-contamination)', () => {
    const profile: IProductProfile = {
      id: 'acme',
      provider: testProvider(),
      presets: [acmeReviewer],
    };

    assembleProduct(profile);
    assembleProduct(profile); // a second call must not accumulate / throw duplicate-id

    expect(getPreset('acme-reviewer')).toBeUndefined();
    expect(() => resolvePreset('acme-reviewer')).toThrow(/Unknown preset/);
  });
});

describe('assembleProduct — runtime construction delegates to the framework seam (R2)', () => {
  it('buildRuntime returns an InteractiveSession built via buildRuntimeSession, threading the assembled modules', async () => {
    const profile: IProductProfile = {
      id: 'acme',
      provider: testProvider(),
      baseCommandModules: [commandModule('help')],
      packs: [{ id: 'coding', tools: [tool('Glob')] }],
    };

    const product = assembleProduct(profile);
    const session = product.buildRuntime({ session: { cwd: process.cwd(), provider: profile.provider } });

    try {
      // Delegation, not re-implementation: buildRuntimeSession returns an InteractiveSession.
      expect(session).toBeInstanceOf(InteractiveSession);
      expect(Array.isArray(session.listCommands())).toBe(true);
    } finally {
      // Drain the async session init so its fire-and-forget lifecycle does not leak past the test.
      await session.shutdown();
    }
  });
});
