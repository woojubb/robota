import { FunctionTool } from '@robota-sdk/agent-core';
import { createScriptedProvider } from '@robota-sdk/agent-core/testing';
import { InteractiveSession } from '@robota-sdk/agent-framework';
import { createPresetRegistry } from '@robota-sdk/agent-preset';
import { describe, expect, expectTypeOf, it } from 'vitest';

import { PRODUCT_PROFILE_FIELD_POLICIES, assembleProduct } from '../assemble-product.js';

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
  it('classifies every profile field and excludes the obsolete providerOverride key', () => {
    expect(PRODUCT_PROFILE_FIELD_POLICIES).toEqual({
      id: 'surfaced',
      agentName: 'surfaced',
      version: 'surfaced',
      providerDefinitions: 'consumed-and-surfaced',
      providerSettings: 'consumed',
      provider: 'consumed-and-surfaced',
      presets: 'consumed',
      presetRegistry: 'consumed-and-surfaced',
      defaultPresetId: 'consumed-and-surfaced',
      presetContext: 'consumed',
      packs: 'consumed',
      baseCommandModules: 'consumed',
      backgroundTaskRunners: 'surfaced',
      subagentRunnerFactory: 'surfaced',
      transports: 'consumed-and-surfaced',
    });
    type TProviderOverrideAbsent = 'providerOverride' extends keyof IProductProfile ? false : true;
    expectTypeOf<TProviderOverrideAbsent>().toEqualTypeOf<true>();
  });

  it('surfaces identity and injected runtime plumbing without changing object identity', () => {
    const backgroundTaskRunner = { kind: 'process', start: () => undefined } as never;
    const subagentRunnerFactory = (() => ({ run: async () => undefined })) as never;
    const transportRegistry = { marker: 'transport-registry' } as never;
    let transportFactoryCalls = 0;

    const product = assembleProduct({
      id: 'acme',
      agentName: 'Acme Agent',
      version: '1.2.3',
      providerDefinitions: [],
      backgroundTaskRunners: [backgroundTaskRunner],
      subagentRunnerFactory,
      transports: () => {
        transportFactoryCalls += 1;
        return transportRegistry;
      },
    });

    expect(product.agentName).toBe('Acme Agent');
    expect(product.version).toBe('1.2.3');
    expect(product.backgroundTaskRunners).toEqual([backgroundTaskRunner]);
    expect(product.backgroundTaskRunners[0]).toBe(backgroundTaskRunner);
    expect(product.subagentRunnerFactory).toBe(subagentRunnerFactory);
    expect(transportFactoryCalls).toBe(1);
    expect(product.transports).toBe(transportRegistry);
  });

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

  it('projects accepted metadata and atomic duplicate-pack rejections losslessly', () => {
    const product = assembleProduct({
      id: 'acme',
      providerDefinitions: [],
      provider: testProvider(),
      packs: [
        {
          id: 'accepted',
          title: 'Accepted Pack',
          description: 'Visible metadata',
          commandModules: [commandModule('accepted-command')],
        },
        {
          id: 'accepted',
          commandModules: [commandModule('must-not-land')],
        },
        { id: 'following', commandModules: [commandModule('following-command')] },
      ],
    });

    expect(product.acceptedPacks).toEqual([
      { id: 'accepted', title: 'Accepted Pack', description: 'Visible metadata' },
      { id: 'following' },
    ]);
    expect(product.rejectedPacks).toEqual([{ packId: 'accepted', reason: 'duplicate pack id' }]);
    expect(product.commandModules.map((entry) => entry.name)).toEqual([
      'accepted-command',
      'following-command',
    ]);
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
      packId: 'p',
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

    // ARCH-009: this used to ask agent-preset's module-global readers whether the assembly had leaked
    // into them. There is no global left to leak into, so the question is now asked of a registry
    // built after the two assemblies — the property that mattered, and one that can still fail.
    const later = createPresetRegistry();
    expect(later.getPreset('acme-reviewer')).toBeUndefined();
    expect(() => later.resolvePreset('acme-reviewer')).toThrow(/Unknown preset/);
  });

  // ARCH-008: a consumer that had to resolve a preset BEFORE it could build the profile (a preset can
  // carry the `model`/`agentName` the profile is constructed from) hands its own instance registry in,
  // so the pre-assembly resolution and the assembler's resolution are ONE path, not two equivalent ones.
  it('ADOPTS a caller-supplied registry instead of building a second, equivalent one', () => {
    const registry = createPresetRegistry([acmeReviewer]);
    const product = assembleProduct({
      id: 'acme',
      providerDefinitions: [],
      provider: testProvider(),
      presetRegistry: registry,
      defaultPresetId: 'acme-reviewer',
    });

    // The same object — an equal-but-separate registry would be a second resolution path.
    expect(product.presets).toBe(registry);
    expect(product.resolvePreset('acme-reviewer').persona).toBe(
      'You are a meticulous code reviewer.',
    );
  });

  it('lets the supplied registry WIN over `presets` (they are not merged)', () => {
    const product = assembleProduct({
      id: 'acme',
      providerDefinitions: [],
      provider: testProvider(),
      presets: [acmeReviewer],
      presetRegistry: createPresetRegistry([]),
    });

    expect(product.presets.getPreset('acme-reviewer')).toBeUndefined();
  });

  it('resolves defaultPresetId with the profile’s presetContext (override layers included)', () => {
    const product = assembleProduct({
      id: 'acme',
      providerDefinitions: [],
      provider: testProvider(),
      presets: [acmeReviewer],
      defaultPresetId: 'acme-reviewer',
      presetContext: { cliOverrides: { model: 'flag-model', permissionMode: 'plan' } },
    });

    // Without the context this would be the bare preset posture — persona + permissionMode 'default'
    // (from `autonomy: 'ask-first'`) and no model. `defaultPreset` must be the CALLER's resolution.
    expect(product.defaultPreset).toEqual(
      createPresetRegistry([acmeReviewer]).resolvePreset('acme-reviewer', {
        cliOverrides: { model: 'flag-model', permissionMode: 'plan' },
      }),
    );
    expect(product.defaultPreset).toMatchObject({ model: 'flag-model', permissionMode: 'plan' });
  });

  it('carries the context-resolved permission posture into the runtime overlay', () => {
    // The overlay applies `defaultPreset.permissionMode` when the caller left it unset. A defaultPreset
    // resolved WITHOUT the context would carry 'default' here instead of the override's 'plan'.
    const product = assembleProduct({
      id: 'acme',
      providerDefinitions: [],
      provider: testProvider(),
      presets: [acmeReviewer],
      defaultPresetId: 'acme-reviewer',
      presetContext: { cliOverrides: { permissionMode: 'plan' } },
    });

    const options = product.buildRuntimeOptions({
      session: { cwd: process.cwd(), provider: testProvider() },
    });

    expect((options as { permissionMode?: string }).permissionMode).toBe('plan');
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
