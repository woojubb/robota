import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { createTestProductRuntime } from '../../__tests__/helpers/product-runtime.js';
import { buildCommandSetup } from '../../startup/command-setup.js';
import { productProviderDefinitions } from '../provider-definitions.js';
import { createProductSubagentComposition } from '../subagent-composition.js';

import type { IParsedCliArgs } from '../../utils/cli-args.js';
import type { IProviderDefinition, IProviderDefinitionConfig } from '@robota-sdk/agent-core';

/** What each built-in definition's own `createProvider` was handed, recorded beneath the product wrap. */
const received = vi.hoisted(() => [] as IProviderDefinitionConfig[]);

vi.mock('@robota-sdk/agent-builtin-providers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@robota-sdk/agent-builtin-providers')>();
  return {
    ...actual,
    createDefaultProviderDefinitions: () =>
      actual.createDefaultProviderDefinitions().map((definition) => ({
        ...definition,
        createProvider: (config: IProviderDefinitionConfig) => {
          received.push(config);
          return definition.createProvider(config);
        },
      })),
  };
});

const ANTHROPIC: IProviderDefinitionConfig = {
  name: 'anthropic',
  model: 'claude-sonnet-4-6',
  apiKey: 'sk-ant-test',
};
const OPENAI: IProviderDefinitionConfig = { name: 'openai', model: 'gpt-5.1', apiKey: 'sk-test' };

function definitionFor(
  definitions: readonly IProviderDefinition[],
  type: string,
): IProviderDefinition {
  const definition = definitions.find((candidate) => candidate.type === type);
  if (definition === undefined) throw new Error(`no ${type} definition`);
  return definition;
}

function webSearchEnabled(
  definitions: readonly IProviderDefinition[],
  config: IProviderDefinitionConfig,
): boolean | undefined {
  return definitionFor(definitions, config.name).createProvider(config).getCapabilities?.()
    .nativeWebTools.webSearch.enabled;
}

describe('productProviderDefinitions native web search default', () => {
  beforeEach(() => {
    received.length = 0;
  });

  it('turns native web search on for an Anthropic profile without options', () => {
    expect(webSearchEnabled(productProviderDefinitions(), ANTHROPIC)).toBe(true);
    expect(received.at(-1)?.options).toEqual({ nativeWebTools: { webSearch: true } });
  });

  it('turns it on for an Anthropic profile whose options leave nativeWebTools out, keeping the rest', () => {
    const options = { somethingElse: 'kept' };

    expect(webSearchEnabled(productProviderDefinitions(), { ...ANTHROPIC, options })).toBe(true);
    expect(received.at(-1)?.options).toEqual({
      somethingElse: 'kept',
      nativeWebTools: { webSearch: true },
    });
    expect(options).toEqual({ somethingElse: 'kept' });
  });

  it('uses a profile that sets nativeWebTools as written', () => {
    const off = { ...ANTHROPIC, options: { nativeWebTools: { webSearch: false } } };
    const empty = { ...ANTHROPIC, options: { nativeWebTools: {} } };

    expect(webSearchEnabled(productProviderDefinitions(), off)).toBe(false);
    expect(received.at(-1)).toBe(off);
    expect(webSearchEnabled(productProviderDefinitions(), empty)).toBe(false);
    expect(received.at(-1)).toBe(empty);
  });

  it('leaves every other provider definition untouched', () => {
    const provider = definitionFor(productProviderDefinitions(), 'openai').createProvider(OPENAI);

    // The OpenAI definition throws on `nativeWebTools.webSearch: true`, so a default leaked to it
    // would fail the build of the provider instead of reaching this line.
    expect(provider.getCapabilities?.().nativeWebTools.webSearch.enabled).toBe(false);
    expect(received.at(-1)).toBe(OPENAI);
  });
});

describe('productProviderDefinitions reaches the parent session and the child-process worker', () => {
  const cwd = realpathSync(mkdtempSync(join(tmpdir(), 'product-provider-definitions-')));
  afterAll(() => rmSync(cwd, { recursive: true, force: true }));

  beforeEach(() => {
    received.length = 0;
  });

  it('applies to the parent session when the caller supplies no provider definitions', () => {
    const setup = buildCommandSetup(
      cwd,
      { noUpdateCheck: true } as unknown as IParsedCliArgs,
      { productRuntime: createTestProductRuntime('test-product', { HOME: cwd }) },
      '0.0.0-test',
    );

    expect(setup.callerSuppliedProviderDefinitions).toBe(false);
    expect(webSearchEnabled(setup.providerDefinitions, ANTHROPIC)).toBe(true);
  });

  it('applies to the child-process subagent composition the same way', () => {
    const { providerDefinitions } = createProductSubagentComposition(
      createTestProductRuntime('test-product', { HOME: cwd }),
    );

    expect(webSearchEnabled(providerDefinitions, ANTHROPIC)).toBe(true);
    expect(
      webSearchEnabled(providerDefinitions, {
        ...ANTHROPIC,
        options: { nativeWebTools: { webSearch: false } },
      }),
    ).toBe(false);
  });

  it('uses a caller-supplied set as given, without layering the default onto it', () => {
    const supplied = productProviderDefinitions().map((definition) => ({ ...definition }));
    const setup = buildCommandSetup(
      cwd,
      { noUpdateCheck: true } as unknown as IParsedCliArgs,
      {
        productRuntime: createTestProductRuntime('test-product', { HOME: cwd }),
        providerDefinitions: supplied,
      },
      '0.0.0-test',
    );

    expect(setup.providerDefinitions).toBe(supplied);
    expect(setup.callerSuppliedProviderDefinitions).toBe(true);
  });
});
