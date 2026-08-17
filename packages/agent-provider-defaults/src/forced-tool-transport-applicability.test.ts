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
 * It lives here because `agent-provider-defaults` is the one package that depends on every provider;
 * `agent-core` cannot, and no single provider can see its siblings.
 */

import { describe, expect, it } from 'vitest';

import { resolveStructuredOutputCapability } from '@robota-sdk/agent-core';
import { AnthropicProvider } from '@robota-sdk/agent-provider-anthropic';
import { GeminiProvider } from '@robota-sdk/agent-provider-gemini';
import { OpenAIProvider } from '@robota-sdk/agent-provider-openai';
import { DeepSeekProvider, QwenProvider } from '@robota-sdk/agent-provider-openai-compatible';

import type { IAIProvider, TStructuredOutputMechanism } from '@robota-sdk/agent-core';

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
 * Every provider this workspace ships, with a representative model and whether its package exposes
 * enforceable strict tool arguments.
 *
 * `strictTools` is asserted by presence in the provider's published options rather than assumed, so
 * a provider that GAINS the capability changes this table by failing, not by being forgotten.
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
      hasStrictToolArguments: true,
    },
    {
      name: 'anthropic',
      provider: new AnthropicProvider({ apiKey: NOT_USED }),
      model: 'claude-sonnet-4-6',
      hasStrictToolArguments: false,
    },
    {
      name: 'gemini',
      provider: new GeminiProvider({ apiKey: NOT_USED }),
      model: 'gemini-2.5-pro',
      hasStrictToolArguments: false,
    },
    {
      name: 'deepseek',
      provider: new DeepSeekProvider({ apiKey: NOT_USED }),
      model: 'deepseek-chat',
      hasStrictToolArguments: false,
    },
    {
      name: 'qwen',
      provider: new QwenProvider({ apiKey: NOT_USED, baseURL: 'https://example.invalid/v1' }),
      model: 'qwen-max',
      hasStrictToolArguments: false,
    },
  ];
}

describe('CORE-048 — the forced-tool-call transport has no applicable provider', () => {
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
