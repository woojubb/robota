import { createTestProductRuntime } from '../../__tests__/helpers/product-runtime.js';
import { describe, expect, it } from 'vitest';

import { createInProcessSubagentRunner } from '@robota-sdk/agent-framework';
import { TRANSPORT_ENVIRONMENT } from '@robota-sdk/agent-executor';

import { createProductCapabilityPacks } from '../product-profile.js';
import {
  createProductSubagentComposition,
  createProductSubagentRunnerFactory,
  productChildProviderEnvironment,
} from '../subagent-composition.js';
import {
  nonReproducibleProviderComposition,
  selectProductSubagentRunner,
} from '../subagent-provider-reproduction.js';

import type { IProviderDefinition } from '@robota-sdk/agent-core';
import type { TSubagentRunnerFactory } from '@robota-sdk/agent-framework';

describe('ARCH-109 — the provider dimension of "can the child reproduce this?"', () => {
  /**
   * A definition set that is NOT the default one, and shares a built-in's `type` on purpose.
   *
   * The shared name is the point. It is the case a name-comparison check would call "same" and the
   * child would then run different code for — which is why the ORIGIN is reported by the composition
   * root rather than re-derived from the definitions downstream.
   */
  const CALLER_DEFINITIONS = [
    { type: 'openai', createProvider: () => ({}) },
  ] as unknown as readonly IProviderDefinition[];

  it('names each composition a child cannot rebuild, and says nothing about one it can', () => {
    expect(
      nonReproducibleProviderComposition({
        callerSuppliedDefinitions: true,
        replayProvider: false,
      }),
    ).toEqual(['caller-supplied providerDefinitions']);
    expect(
      nonReproducibleProviderComposition({
        callerSuppliedDefinitions: false,
        replayProvider: true,
      }),
    ).toEqual(['a replay provider (--session-log)']);
    expect(
      nonReproducibleProviderComposition({
        callerSuppliedDefinitions: false,
        replayProvider: false,
      }),
    ).toEqual([]);
  });

  it('the child recipe carries the definitions it is GIVEN, not an imported default set', () => {
    // The seam this fills already existed — `ISubagentWorkerComposition.providerDefinitions` is
    // documented as carrying definitions so "a custom provider type resolves instead of throwing
    // `Unknown provider`". The product's worker entry pinned it to the default set, so the seam was
    // present and unused. Asserting identity, not a name match: a name match passes for the default
    // set too, and so would not fail on the defect this names.
    const composition = createProductSubagentComposition(
      createTestProductRuntime(),
      (context) => createProductCapabilityPacks(context, createTestProductRuntime()),
      CALLER_DEFINITIONS,
    );

    expect(composition.providerDefinitions).toBe(CALLER_DEFINITIONS);
    expect(
      createProductSubagentComposition(createTestProductRuntime()).providerDefinitions,
    ).not.toBe(CALLER_DEFINITIONS);
  });
});

describe('ARCH-109 — a composition a child cannot rebuild keeps its subagents in-process', () => {
  function record(): { readonly notices: string[]; readonly notice: (m: string) => void } {
    const notices: string[] = [];
    return { notices, notice: (m) => notices.push(m) };
  }

  it('never builds the child-process runner, so no live provider config is assembled to cross', () => {
    const { notices, notice } = record();
    let built = 0;

    const runner = selectProductSubagentRunner({
      reproduction: { callerSuppliedDefinitions: false, replayProvider: true },
      buildChildProcess: () => {
        built += 1;
        return createInProcessSubagentRunner;
      },
      notice,
    });

    // The stronger of the two assertions. "The returned runner is the in-process one" would pass
    // even if the child runner had been constructed and discarded — and constructing it is what
    // reads `providerConfig`, which carries `apiKey`. Zero calls is the property.
    expect(built).toBe(0);
    expect(runner).toBe(createInProcessSubagentRunner);
    expect(notices).toHaveLength(1);
    expect(notices[0]).toMatch(/--session-log/);
    // Isolation was given up. Saying so is the difference between a fallback and a silent downgrade.
    expect(notices[0]).toMatch(/isolation is off/);
  });

  it('falls back for caller-supplied definitions rather than refusing the session', () => {
    const { notices, notice } = record();

    const runner = selectProductSubagentRunner({
      reproduction: { callerSuppliedDefinitions: true, replayProvider: false },
      buildChildProcess: () => {
        throw new Error('the child runner must not be built for an unreproducible composition');
      },
      notice,
    });

    // Regression guard with a measured cause: the first draft THREW here, and 20 existing tests
    // driving the CLI through `startCli({ providerDefinitions })` failed — none of which spawn a
    // subagent. Supplying your own providers is the supported way to embed the product, so refusing
    // it was a false positive against working software.
    expect(runner).toBe(createInProcessSubagentRunner);
    // And SILENTLY, which is the second half of the same measurement. Four more tests assert an
    // empty stderr for print and JSON runs, where stderr is part of the output contract — and an
    // embedding program cannot act on the warning anyway, since the product exposes no paired worker
    // entry to fix it with. The operator-typed `--session-log` case above is the one that speaks.
    expect(notices).toEqual([]);
  });

  it('builds the child-process runner for an ordinary run, and says nothing', () => {
    const { notices, notice } = record();
    const sentinel = (() => undefined) as unknown as TSubagentRunnerFactory;
    let built = 0;

    const runner = selectProductSubagentRunner({
      reproduction: { callerSuppliedDefinitions: false, replayProvider: false },
      buildChildProcess: () => {
        built += 1;
        return sentinel;
      },
      notice,
    });

    // The control half. Without it, a selector that returned the in-process runner unconditionally
    // would satisfy every test above and quietly remove process isolation from every session.
    expect(built).toBe(1);
    expect(runner).toBe(sentinel);
    expect(notices).toEqual([]);
  });

  it('keeps a literal credential in-process without constructing a child runner', () => {
    let built = 0;
    const runner = selectProductSubagentRunner({
      reproduction: {
        callerSuppliedDefinitions: false,
        replayProvider: false,
        literalCredential: true,
      },
      buildChildProcess: () => {
        built += 1;
        throw new Error('child runner must not be constructed');
      },
      notice: () => {},
    });
    expect(runner).toBe(createInProcessSubagentRunner);
    expect(built).toBe(0);
  });

  it('selects in-process from the real CLI composition for a literal credential or connection drift', () => {
    const runtime = createTestProductRuntime('cedar', {
      HOME: '/tmp/synthetic-home',
      HTTPS_PROXY: 'https://synthetic-selected-proxy.invalid',
    });
    const base = {
      productRuntime: runtime,
      packContext: { cwd: '/tmp/synthetic-workspace' },
      providerDefinitions: [
        { type: 'openai', createProvider: () => ({}) } as unknown as IProviderDefinition,
      ],
      reproduction: { callerSuppliedDefinitions: false, replayProvider: false },
      notice: () => {},
    };
    expect(
      createProductSubagentRunnerFactory({
        ...base,
        providerConfig: { name: 'openai', model: 'fixture-model', apiKey: 'synthetic-literal-key' },
      }),
    ).toBe(createInProcessSubagentRunner);
    expect(
      createProductSubagentRunnerFactory({
        ...base,
        providerConfig: {
          name: 'openai',
          model: 'fixture-model',
          apiKey: 'synthetic-ref-key',
          apiKeyEnv: 'SYNTHETIC_REF_KEY',
        },
      }),
    ).toBe(createInProcessSubagentRunner);
  });

  it('retains the child-process runner for a referenced selected-file key with matching destination environment', () => {
    const transport = Object.fromEntries(
      TRANSPORT_ENVIRONMENT.map((name) => [name, process.env[name]]),
    );
    const runtime = createTestProductRuntime('cedar', {
      ...transport,
      HOME: '/tmp/synthetic-home',
      SYNTHETIC_REF_KEY: 'synthetic-file-key',
    });
    const runner = createProductSubagentRunnerFactory({
      productRuntime: runtime,
      packContext: { cwd: '/tmp/synthetic-workspace' },
      providerConfig: {
        name: 'openai',
        model: 'fixture-model',
        apiKey: 'synthetic-file-key',
        apiKeyEnv: 'SYNTHETIC_REF_KEY',
      },
      providerDefinitions: [
        { type: 'openai', createProvider: () => ({}) } as unknown as IProviderDefinition,
      ],
      reproduction: { callerSuppliedDefinitions: false, replayProvider: false },
      notice: () => {},
    });
    expect(runner).not.toBe(createInProcessSubagentRunner);
  });

  it('keeps host-stored provider origins in process even before the raw key has been resolved', () => {
    const transport = Object.fromEntries(
      TRANSPORT_ENVIRONMENT.map((name) => [name, process.env[name]]),
    );
    const runner = createProductSubagentRunnerFactory({
      productRuntime: createTestProductRuntime('cedar', {
        ...transport,
        HOME: '/tmp/synthetic-home',
      }),
      packContext: { cwd: '/tmp/synthetic-workspace' },
      providerConfig: {
        name: 'openrouter',
        model: 'fixture-model',
        apiKeyRef: { service: 'robota.provider.openrouter', account: 'fixture-only' },
      },
      providerDefinitions: [
        { type: 'openrouter', createProvider: () => ({}) } as unknown as IProviderDefinition,
      ],
      reproduction: { callerSuppliedDefinitions: false, replayProvider: false },
      notice: () => {},
    });
    expect(runner).toBe(createInProcessSubagentRunner);
  });

  it('projects only named provider inputs across A/B/A child environments', () => {
    const definitions = [
      {
        type: 'openai',
        destinationEnvironment: ['SYNTHETIC_PROVIDER_ENDPOINT'],
        createProvider: () => ({}),
      },
    ] as unknown as readonly IProviderDefinition[];
    const provider = { name: 'openai', model: 'fixture-model', apiKeyEnv: 'SYNTHETIC_REF_KEY' };
    const makeRuntime = (label: string, key: string) =>
      createTestProductRuntime(label, {
        HOME: '/tmp/synthetic-home',
        SYNTHETIC_REF_KEY: key,
        SYNTHETIC_PROVIDER_ENDPOINT: `https://${label}.invalid`,
        HTTPS_PROXY: `https://${label}-proxy.invalid`,
        SYNTHETIC_UNRELATED_PARENT_SECRET: 'must-not-cross',
      });
    const a = makeRuntime('cedar', 'synthetic-a-key');
    const b = makeRuntime('maple', 'synthetic-b-key');
    const projected = [a, b, a].map((runtime) =>
      productChildProviderEnvironment(runtime, provider, definitions),
    );
    expect(
      projected.map((env) => [
        env.PRODUCT_ID,
        env.SYNTHETIC_REF_KEY,
        env.SYNTHETIC_PROVIDER_ENDPOINT,
        env.HTTPS_PROXY,
      ]),
    ).toEqual([
      ['cedar', 'synthetic-a-key', 'https://cedar.invalid', 'https://cedar-proxy.invalid'],
      ['maple', 'synthetic-b-key', 'https://maple.invalid', 'https://maple-proxy.invalid'],
      ['cedar', 'synthetic-a-key', 'https://cedar.invalid', 'https://cedar-proxy.invalid'],
    ]);
    for (const env of projected) expect(env.SYNTHETIC_UNRELATED_PARENT_SECRET).toBeUndefined();
  });
});
