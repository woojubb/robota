import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createTestProductRuntime } from '../../__tests__/helpers/product-runtime.js';
import { buildCommandSetup } from '../../startup/command-setup.js';
import { productProviderDefinitions } from '../provider-definitions.js';
import { createProductSubagentComposition } from '../subagent-composition.js';

import type { IParsedCliArgs } from '../../utils/cli-args.js';
import type { IProviderDefinition, IProviderDefinitionConfig } from '@robota-sdk/agent-core';

/** What each built-in definition's own `createProvider` was handed, recorded beneath the product wrap. */
const received = vi.hoisted(() => [] as IProviderDefinitionConfig[]);

vi.mock('@robota-sdk/agent-provider/builtin', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@robota-sdk/agent-provider/builtin')>();
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
const GEMINI: IProviderDefinitionConfig = {
  name: 'gemini',
  model: 'gemini-3-flash-preview',
  apiKey: 'gemini-test',
};
const DEEPSEEK: IProviderDefinitionConfig = {
  name: 'deepseek',
  model: 'deepseek-chat',
  apiKey: 'deepseek-test',
};

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
    // A developer's own gateway variable would change which profiles OpenAI declares search for.
    vi.stubEnv('OPENAI_BASE_URL', '');
  });
  afterEach(() => {
    vi.unstubAllEnvs();
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

  it('turns it on for an OpenAI profile without options', () => {
    expect(webSearchEnabled(productProviderDefinitions(), OPENAI)).toBe(true);
    expect(received.at(-1)?.options).toEqual({ nativeWebTools: { webSearch: true } });
  });

  it('leaves a Gemini profile as written, so it searches only when it asks', () => {
    expect(webSearchEnabled(productProviderDefinitions(), GEMINI)).toBe(false);
    expect(received.at(-1)).toBe(GEMINI);

    const asking = { ...GEMINI, options: { nativeWebTools: { webSearch: true } } };
    expect(webSearchEnabled(productProviderDefinitions(), asking)).toBe(true);
    expect(received.at(-1)).toBe(asking);
  });

  it.each([
    ['a compatible endpoint', { ...OPENAI, baseURL: 'http://localhost:1234/v1' }],
    ['Chat Completions', { ...OPENAI, options: { apiSurface: 'chat-completions' } }],
  ])('builds an OpenAI profile on %s untouched', (_label, profile) => {
    // The OpenAI definition throws on `nativeWebTools.webSearch: true` here, so a default leaked to
    // such a profile would fail the build of the provider instead of reaching this line.
    expect(webSearchEnabled(productProviderDefinitions(), profile)).toBe(false);
    expect(received.at(-1)).toBe(profile);
  });

  it('leaves an OpenAI profile alone while OPENAI_BASE_URL redirects the SDK', () => {
    vi.stubEnv('OPENAI_BASE_URL', 'https://gateway.example.com/v1');

    expect(webSearchEnabled(productProviderDefinitions(), OPENAI)).toBe(false);
    expect(received.at(-1)).toBe(OPENAI);
  });

  it('leaves a provider definition that declares nothing untouched', () => {
    expect(webSearchEnabled(productProviderDefinitions(), DEEPSEEK)).toBe(false);
    expect(received.at(-1)).toBe(DEEPSEEK);
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
