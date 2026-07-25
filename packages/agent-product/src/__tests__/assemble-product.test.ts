import { FunctionTool } from '@robota-sdk/agent-core';
import { createScriptedProvider } from '@robota-sdk/agent-core/testing';
import { InteractiveSession } from '@robota-sdk/agent-framework';
import { getPreset, resolvePreset } from '@robota-sdk/agent-preset';
import { describe, expect, it } from 'vitest';

import { assembleProduct } from '../assemble-product.js';

import type { IProductProfile } from '../product-profile.js';
import type { IAIProvider, IProviderDefinition } from '@robota-sdk/agent-core';
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
      providerDefinitions: [],
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
      providerDefinitions: [],
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
      providerDefinitions: [],
      provider: testProvider(),
      presets: [acmeReviewer],
      defaultPresetId: 'acme-reviewer',
    };

    const product = assembleProduct(profile);

    expect(product.resolvePreset('acme-reviewer').persona).toBe(
      'You are a meticulous code reviewer.',
    );
    expect(product.defaultPresetId).toBe('acme-reviewer');
    // built-ins remain reachable through the instance registry
    expect(product.presets.getPreset('default')).toBeDefined();
  });

  it('does NOT mutate the module-global preset registry (R8 — no cross-contamination)', () => {
    const profile: IProductProfile = {
      id: 'acme',
      providerDefinitions: [],
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
      providerDefinitions: [],
      provider: testProvider(),
      baseCommandModules: [commandModule('help')],
      packs: [{ id: 'coding', tools: [tool('Glob')] }],
    };

    const product = assembleProduct(profile);
    const session = product.buildRuntime({
      session: { cwd: process.cwd(), provider: testProvider() },
    });

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

/**
 * ARCH-005 S2 / OWNER DECISION 1 — provider construction returns IN-KERNEL.
 *
 * The kernel constructs the provider from `providerDefinitions` + ALREADY-RESOLVED `providerSettings`
 * via `createProviderFromConfig`, which lives in `@robota-sdk/agent-core` (relocated there by
 * ARCH-PROVIDER-003, re-exported by `agent-executor`) — an ALLOWED dependency layer, so the fold stays
 * pure and IO-free: settings are resolved by the SHELL and passed IN as data. `provider` remains an
 * OPTIONAL injected override for advanced/test consumers.
 */
describe('assembleProduct — provider construction (owner Decision 1)', () => {
  function definition(type: string): IProviderDefinition {
    return {
      type,
      defaults: { model: `${type}-default-model` },
      createProvider: (config) =>
        // Tag the instance so the test can prove it came from THIS definition with THIS config.
        Object.assign(createScriptedProvider([{ text: 'ok' }]).provider, {
          builtFrom: `${type}:${config.model}`,
        }) as IAIProvider,
    };
  }

  function builtFrom(provider: IAIProvider | undefined): string | undefined {
    return (provider as unknown as { builtFrom?: string } | undefined)?.builtFrom;
  }

  it('constructs the provider from providerDefinitions + already-resolved settings (in-kernel)', () => {
    const product = assembleProduct({
      id: 'acme',
      providerDefinitions: [definition('anthropic'), definition('openai')],
      providerSettings: { name: 'openai', model: 'gpt-5', apiKey: 'sk-test' },
    });

    expect(builtFrom(product.provider)).toBe('openai:gpt-5');
  });

  it('lets an injected provider OVERRIDE settings-based construction (advanced/test escape hatch)', () => {
    const injected = testProvider();
    const product = assembleProduct({
      id: 'acme',
      providerDefinitions: [definition('openai')],
      providerSettings: { name: 'openai', model: 'gpt-5', apiKey: 'sk-test' },
      provider: injected,
    });

    expect(product.provider).toBe(injected);
  });

  it('assembles a Mode A profile carrying ONLY providerDefinitions (no provider, no settings)', () => {
    const product = assembleProduct({
      id: 'acme-assistant',
      agentName: 'acme',
      providerDefinitions: [definition('anthropic')],
      defaultPresetId: 'default',
    });

    expect(product.id).toBe('acme-assistant');
    expect(product.provider).toBeUndefined();
    // The shell supplies the provider at build time in this mode.
    expect(product.providerDefinitions.map((d) => d.type)).toEqual(['anthropic']);
  });

  it('reports an unknown provider type instead of silently producing no provider', () => {
    expect(() =>
      assembleProduct({
        id: 'acme',
        providerDefinitions: [definition('openai')],
        providerSettings: { name: 'nope', model: 'm', apiKey: 'k' },
      }),
    ).toThrow(/Unknown provider: nope/);
  });
});

/**
 * ARCH-005 S2 / OWNER DECISION 2 — merged pack subagents reach the RUNTIME through the framework's
 * `agentDefinitions` injection seam, instead of being exposed as inert material the shell must re-wire.
 * `buildRuntimeOptions` is the pure overlay `buildRuntime` delegates through, so the contract is
 * assertable without constructing a live session.
 */
describe('assembleProduct — pack subagents reach the runtime seam (owner Decision 2)', () => {
  it('overlays the merged pack subagents as session `agentDefinitions`', () => {
    const product = assembleProduct({
      id: 'acme',
      providerDefinitions: [],
      provider: testProvider(),
      packs: [{ id: 'coding', subagents: [subagent('Explore'), subagent('Plan')] }],
    });

    const options = product.buildRuntimeOptions({
      session: { cwd: process.cwd(), provider: testProvider() },
    });

    expect(
      (options as { agentDefinitions?: readonly IAgentDefinition[] }).agentDefinitions?.map(
        (a) => a.name,
      ),
    ).toEqual(['Explore', 'Plan']);
  });

  it('leaves `agentDefinitions` unset when no pack contributes a subagent (framework default)', () => {
    const product = assembleProduct({
      id: 'acme',
      providerDefinitions: [],
      provider: testProvider(),
    });

    const options = product.buildRuntimeOptions({
      session: { cwd: process.cwd(), provider: testProvider() },
    });

    expect('agentDefinitions' in options).toBe(false);
  });
});
