/**
 * CORE-048 — the forced-tool-call structured-output transport has NO applicable provider, and this
 * is the tripwire that fires when that stops being true.
 *
 * ## The question, and why it is answerable here
 *
 * CORE-038 proposed forcing a call to a synthetic tool whose parameters ARE the output schema, and
 * was judged `DEPTH: FOUNDATIONAL`: the transport may be right, but it was stated above its cause.
 * CORE-043 built the cause — a `(provider, model)` pair now resolves to a `TStructuredOutputMechanism`
 * — and deliberately left `'tool_strict'` out of that vocabulary, because a union member nothing
 * produces is a branch every consumer must handle and no test can reach.
 *
 * CORE-048 asked whether it has earned a member. The transport is only worth anything for a pair
 * that BOTH lacks a schema parameter AND has enforceable strict tool arguments. Measured across the
 * workspace, that intersection is **empty**:
 *
 * | provider  | resolved mechanism            | strict tool arguments |
 * | --------- | ----------------------------- | --------------------- |
 * | openai    | `response_schema` (undeclared) | YES — `strictTools`   |
 * | anthropic | `response_schema` (json_schema)| no                    |
 * | gemini    | `response_schema` (json_schema)| no                    |
 * | gemma     | `response_schema` (undeclared) | no                    |
 * | deepseek  | `json_object`                  | no                    |
 * | qwen      | `none`                         | no                    |
 *
 * Every provider that HAS strict tool arguments already gets the schema as a native parameter, so a
 * forced tool call would carry nothing the request does not already carry. Every provider that lacks
 * a schema parameter has no strict-tool support to carry it instead. So the transport would be built
 * for nobody — and `'tool_strict'` would be exactly the unreachable branch CORE-043 declined to add,
 * now declined with a measurement rather than with caution.
 *
 * **This item therefore closes with "the improved baseline is good enough" recorded**, which its own
 * Direction names as a legitimate outcome.
 *
 * ## Why a test rather than only a note
 *
 * A decision written down is a decision nobody re-opens. The premise is a property of the provider
 * set, and provider sets change: the day a provider gains strict tool arguments WITHOUT a schema
 * parameter, the question becomes live and nothing would say so. This file fails on that day and
 * names what has to be answered before the transport can be built.
 *
 * It lives here because `agent-builtin-providers` is the one package that depends on every provider;
 * `agent-core` cannot, and no single provider can see its siblings.
 */

import { describe, expect, it } from 'vitest';

import { resolveStructuredOutputCapability } from '@robota-sdk/agent-core';
import { AnthropicProvider } from '@robota-sdk/agent-provider-anthropic';
import { GeminiProvider } from '@robota-sdk/agent-provider-gemini';
import { OpenAIProvider } from '@robota-sdk/agent-provider-openai';
import {
  DeepSeekProvider,
  GemmaProvider,
  QwenProvider,
} from '@robota-sdk/agent-provider-openai-compatible';

import type { IAIProvider, TStructuredOutputMechanism } from '@robota-sdk/agent-core';
import type { IAnthropicProviderOptions } from '@robota-sdk/agent-provider-anthropic';
import type { IGeminiProviderOptions } from '@robota-sdk/agent-provider-gemini';
import type { IOpenAIProviderOptions } from '@robota-sdk/agent-provider-openai';
import type {
  IDeepSeekProviderOptions,
  IGemmaProviderOptions,
  IQwenProviderOptions,
} from '@robota-sdk/agent-provider-openai-compatible';

/**
 * Drop index signatures, so `'strictTools' extends keyof T` asks about a DECLARED member.
 *
 * `IGemmaProviderOptions` carries `[key: string]: TGemmaProviderOptionValue`, which makes
 * `keyof T` include `string` and would answer `true` for every name ever spelled — the check would
 * report that every open-ended options bag supports strict tool arguments.
 */
type DeclaredKeys<T> = {
  [K in keyof T as string extends K ? never : number extends K ? never : K]: T[K];
};

/**
 * Whether a provider's published options DECLARE strict tool arguments — CORE-048.
 *
 * Derived by the compiler from the interface itself, not written down. That distinction is the
 * whole point and was got wrong once: this table held hand-written booleans while the docblock
 * claimed they were "asserted by presence in the provider's published options". They were not, so a
 * provider that GAINED the capability would have left its `false` in place and silently disabled the
 * tripwire — a check that cannot fail, which is the defect this file exists to prevent, one level up.
 *
 * Now a provider that adds `strictTools` flips this type to `true`, and the `false` recorded below
 * stops type-checking. The failure is a compile error, before any test runs.
 */
type DeclaresStrictTools<T> = 'strictTools' extends keyof DeclaredKeys<T> ? true : false;

const STRICT_TOOL_SUPPORT = {
  openai: true satisfies DeclaresStrictTools<IOpenAIProviderOptions>,
  anthropic: false satisfies DeclaresStrictTools<IAnthropicProviderOptions>,
  gemini: false satisfies DeclaresStrictTools<IGeminiProviderOptions>,
  gemma: false satisfies DeclaresStrictTools<IGemmaProviderOptions>,
  deepseek: false satisfies DeclaresStrictTools<IDeepSeekProviderOptions>,
  qwen: false satisfies DeclaresStrictTools<IQwenProviderOptions>,
} as const;

const NOT_USED = 'not-used-no-request-is-sent';

/**
 * Resolve a provider's structured-output capability through the exported resolver.
 *
 * `table` is a REQUIRED field whose value may be `undefined` — not an optional field — because
 * "declares nothing" is an answer the resolver must be given rather than one it may infer from an
 * absent key (CORE-043: silence is not a denial). So it is passed explicitly.
 */
function resolveFor(provider: IAIProvider, model: string): TStructuredOutputMechanism {
  const table = provider.capabilityTable ? provider.capabilityTable() : undefined;
  return resolveStructuredOutputCapability({
    table,
    model,
    ...(provider.endpointIsVendorDefault
      ? { endpointIsVendorDefault: provider.endpointIsVendorDefault() }
      : {}),
  }).mechanism;
}

/**
 * EVERY provider this workspace ships — all six — with a representative model.
 *
 * "Every" is load-bearing and was got wrong once: `gemma` was omitted while this file's own docblock
 * and `agent-core`'s SPEC both named six. A tripwire with a hole in its coverage is worse than no
 * tripwire, because it reads as a check. The first case below asserts the matrix against the
 * documented set, so the next omission fails instead of passing quietly.
 *
 * Strict-tool support is read from {@link STRICT_TOOL_SUPPORT}, which the COMPILER derives from each
 * provider's published options interface — so a provider that GAINS the capability changes this
 * table by failing to build, not by being forgotten. Verified by giving `IDeepSeekProviderOptions`
 * a `strictTools` member: `Type 'false' does not satisfy the expected type 'true'`.
 */
function providerMatrix(): Array<{
  name: string;
  provider: IAIProvider;
  model: string;
  hasStrictToolArguments: boolean;
}> {
  return [
    {
      name: 'openai',
      provider: new OpenAIProvider({ apiKey: NOT_USED }),
      model: 'gpt-5',
      hasStrictToolArguments: STRICT_TOOL_SUPPORT.openai,
    },
    {
      name: 'anthropic',
      provider: new AnthropicProvider({ apiKey: NOT_USED }),
      model: 'claude-sonnet-4-6',
      hasStrictToolArguments: STRICT_TOOL_SUPPORT.anthropic,
    },
    {
      name: 'gemini',
      provider: new GeminiProvider({ apiKey: NOT_USED }),
      model: 'gemini-2.5-pro',
      hasStrictToolArguments: STRICT_TOOL_SUPPORT.gemini,
    },
    {
      name: 'gemma',
      // Served over an OpenAI-compatible endpoint, so it is constructed with one. It declares no
      // capability table, which resolves to `response_schema` / `undeclared` — silence is not a
      // denial (CORE-043).
      provider: new GemmaProvider({
        apiKey: NOT_USED,
        baseURL: 'https://example.invalid/v1',
      }) as unknown as IAIProvider,
      model: 'gemma-3-27b-it',
      hasStrictToolArguments: STRICT_TOOL_SUPPORT.gemma,
    },
    {
      name: 'deepseek',
      provider: new DeepSeekProvider({ apiKey: NOT_USED }),
      model: 'deepseek-chat',
      hasStrictToolArguments: STRICT_TOOL_SUPPORT.deepseek,
    },
    {
      name: 'qwen',
      provider: new QwenProvider({ apiKey: NOT_USED, baseURL: 'https://example.invalid/v1' }),
      model: 'qwen-max',
      hasStrictToolArguments: STRICT_TOOL_SUPPORT.qwen,
    },
  ];
}

/** The providers this repository ships, as named in `agent-core`'s SPEC. */
const DOCUMENTED_PROVIDERS = ['anthropic', 'deepseek', 'gemini', 'gemma', 'openai', 'qwen'];

describe('CORE-048 — the forced-tool-call transport has no applicable provider', () => {
  it('measures EVERY provider this workspace ships', () => {
    // The omission this catches is the one that already happened: `gemma` was missing while the
    // docblock and the SPEC both named it. Without this, a provider added later is simply never
    // measured, and the tripwire stays green over a set it does not cover.
    expect(
      providerMatrix()
        .map((entry) => entry.name)
        .sort(),
    ).toEqual(DOCUMENTED_PROVIDERS);
  });

  it('no provider both lacks a schema parameter AND has strict tool arguments', () => {
    const qualifying = providerMatrix().filter((entry) => {
      // "Would benefit" means the schema cannot travel as a parameter. `response_schema` providers
      // already carry it natively, so a forced tool call would add nothing.
      const needsAnotherTransport = resolveFor(entry.provider, entry.model) !== 'response_schema';
      return needsAnotherTransport && entry.hasStrictToolArguments;
    });

    // When this fails, the transport has become answerable and CORE-048's four questions are live
    // again. They are NOT answered here, deliberately — answering them against no implementation
    // would be designing for a provider nobody has:
    //
    //   1. NAME COLLISION. The synthetic tool joins a tool set the user owns; `respond_with_schema`
    //      is not reserved. A collision must be DETECTED, not silently resolved either way.
    //   2. THE MODEL PICKS A REAL TOOL. Under `toolChoice: 'required'` it may call one of the
    //      user's own. CORE-017 makes forcing apply to round 1 only, so this interacts with an
    //      existing rule rather than being free to define — and the run must still terminate.
    //   3. IT MUST BEAT THE CORE-043 BASELINE, which is no longer "guaranteed failure on attempt
    //      one": the schema is now stated in the prompt on the FIRST attempt.
    //   4. ONE IMPLEMENTATION MAY NOT BE WORTH A VOCABULARY MEMBER — `'tool_strict'` is a branch
    //      every consumer of `TStructuredOutputMechanism` must then handle.
    expect(qualifying.map((entry) => entry.name)).toEqual([]);
  });

  it('the one provider WITH strict tool arguments already carries the schema natively', () => {
    // The other half of the same fact, asserted separately so a change to either side is legible.
    // If this ever reports something other than `response_schema`, OpenAI itself becomes the
    // qualifying provider and the question above is live.
    expect(resolveFor(new OpenAIProvider({ apiKey: NOT_USED }) as IAIProvider, 'gpt-5')).toBe(
      'response_schema',
    );
  });

  it('the providers that DO lack a schema parameter are the ones with no strict tools', () => {
    // Named explicitly rather than left implicit in the filter above: these are the pairs a forced
    // tool call would be FOR, and the reason it cannot serve them is that nothing can enforce the
    // tool arguments it would rely on.
    const lacking = providerMatrix()
      .filter((entry) => resolveFor(entry.provider, entry.model) !== 'response_schema')
      .map((entry) => entry.name);

    expect(lacking.sort()).toEqual(['deepseek', 'qwen']);
    expect(
      providerMatrix()
        .filter((entry) => lacking.includes(entry.name))
        .every((entry) => !entry.hasStrictToolArguments),
    ).toBe(true);
  });
});
