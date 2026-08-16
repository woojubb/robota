/**
 * CORE-043: the transport decision, and what it does to an outgoing structured request.
 *
 * Each test names the wrong behaviour it would catch. A test that only restates the implementation
 * cannot go red for the defect the item was filed about.
 */

import { describe, expect, it } from 'vitest';

import { applyStructuredOutputTransport } from '../execution-structured-output-guard';
import { resolveStructuredOutputCapability } from '../structured-output-transport';

import type { IResolvedProviderInfo } from '../execution-types';
import type { IProviderCapabilityTable } from '../../interfaces/model-capability';
import type { TUniversalMessage } from '../../interfaces/messages';
import type { IChatOptions } from '../../interfaces/provider';

const SCHEMA_TABLE: IProviderCapabilityTable = {
  vendorDefault: ['tools', 'json_schema', 'streaming'],
  verifiedAt: '2026-01-01',
};

const JSON_OBJECT_TABLE: IProviderCapabilityTable = {
  vendorDefault: ['tools', 'json_object', 'streaming'],
  deviations: {
    'reasoner-x': { capabilities: ['reasoning', 'json_object'], verifiedAt: '2026-01-01' },
  },
  verifiedAt: '2026-01-01',
};

/** A populated list that omits every schema capability — a genuine denial, not silence. */
const NO_SCHEMA_TABLE: IProviderCapabilityTable = {
  vendorDefault: ['tools', 'streaming'],
  verifiedAt: '2026-01-01',
};

function resolvedWith(table: IProviderCapabilityTable | undefined): IResolvedProviderInfo {
  return {
    provider: {
      chat: async () => ({}) as TUniversalMessage,
      capabilityTable: () => table,
    },
    currentInfo: { provider: 'test' },
    aiProviderInfo: {
      providerName: 'test',
      model: 'test-model',
      temperature: undefined,
      maxTokens: undefined,
    },
    toolsInfo: [],
    availableTools: [],
  } as unknown as IResolvedProviderInfo;
}

function structuredOptions(): IChatOptions {
  return {
    model: 'test-model',
    responseFormat: { type: 'json_schema', name: 'Person', schema: { type: 'object' } },
  };
}

const HISTORY: TUniversalMessage[] = [
  { role: 'user', content: 'hi', id: 'u1', timestamp: new Date(), state: 'complete' },
];

describe('resolveStructuredOutputCapability', () => {
  it('reports a vendor default separately from a model-specific declaration', () => {
    // Both resolve to the same mechanism, so a single-axis answer would make them indistinguishable
    // — and "we checked this model" is a different amount of knowledge from "we checked the vendor".
    expect(
      resolveStructuredOutputCapability({ table: JSON_OBJECT_TABLE, model: 'chat-x' }),
    ).toMatchObject({ mechanism: 'json_object', provenance: 'vendor-default' });
    expect(
      resolveStructuredOutputCapability({ table: JSON_OBJECT_TABLE, model: 'reasoner-x' }),
    ).toMatchObject({ mechanism: 'json_object', provenance: 'catalog' });
  });

  it('does not read an absent table as a denial', () => {
    // The regression this guards: resolving "we have no table" to `none` would strip a working
    // json_schema from every provider that simply has no verified table yet — a gap in OUR records
    // reported as a limitation of the vendor. PROV-006's miss policy forbids exactly this.
    expect(resolveStructuredOutputCapability({ table: undefined, model: 'gpt-x' })).toMatchObject({
      mechanism: 'response_schema',
      provenance: 'undeclared',
    });
  });

  it('does read a populated list that omits every schema capability as a denial', () => {
    expect(
      resolveStructuredOutputCapability({ table: NO_SCHEMA_TABLE, model: 'any' }),
    ).toMatchObject({
      mechanism: 'none',
    });
  });

  it('keeps the mechanism but downgrades provenance behind a custom endpoint', () => {
    // A gateway still speaks the vendor's protocol, so the request is still worth sending the
    // declared way; what changes is that a violation downstream is explainable.
    expect(
      resolveStructuredOutputCapability({
        table: SCHEMA_TABLE,
        model: 'any',
        endpointIsVendorDefault: false,
      }),
    ).toMatchObject({ mechanism: 'response_schema', provenance: 'unverified-endpoint' });
  });

  it('reports a gateway even when the provider declares no table at all', () => {
    // The `@robota-sdk/agent-provider-openai` case, and the one decision (1) is about: it declares
    // no table by choice, and `baseURL` there ALSO switches the API surface to chat-completions. If
    // the endpoint signal were a field on the table, this provider could only report its endpoint by
    // inventing capability claims nobody verified.
    expect(
      resolveStructuredOutputCapability({
        table: undefined,
        model: 'gpt-x',
        endpointIsVendorDefault: false,
      }),
    ).toMatchObject({ mechanism: 'response_schema', provenance: 'unverified-endpoint' });
  });
});

describe('applyStructuredOutputTransport', () => {
  it('leaves a schema-capable request exactly as asked', () => {
    const options = structuredOptions();
    const plan = applyStructuredOutputTransport(
      options,
      HISTORY,
      'test-model',
      resolvedWith(SCHEMA_TABLE),
    );
    expect(options.responseFormat).toEqual({
      type: 'json_schema',
      name: 'Person',
      schema: { type: 'object' },
    });
    expect(plan.messages).toBe(HISTORY);
    expect(plan.outcome).toMatchObject({ sent: 'json_schema', schemaInPrompt: false });
  });

  it('states the schema on the FIRST attempt when the wire cannot carry it', () => {
    // The defect: the schema was stated in words only by `buildRetryFeedbackInput`, which runs on
    // attempt TWO. Against a provider with no schema parameter, attempt one carried nothing
    // describing the shape and was guaranteed to fail — so "3 attempts" were really two.
    const options = structuredOptions();
    const plan = applyStructuredOutputTransport(
      options,
      HISTORY,
      'test-model',
      resolvedWith(JSON_OBJECT_TABLE),
    );
    expect(options.responseFormat).toEqual({ type: 'json_object' });
    expect(plan.outcome).toMatchObject({ sent: 'json_object', schemaInPrompt: true });
    const added = plan.messages.at(-1);
    expect(added?.role).toBe('system');
    expect(added?.content).toContain('matching this JSON schema');
  });

  it('omits a response-format option no declared transport can honour', () => {
    const options = structuredOptions();
    const plan = applyStructuredOutputTransport(
      options,
      HISTORY,
      'test-model',
      resolvedWith(NO_SCHEMA_TABLE),
    );
    expect(options.responseFormat).toBeUndefined();
    expect(plan.outcome).toMatchObject({ sent: 'omitted', schemaInPrompt: true });
  });

  it('never appends the instruction to the caller history array', () => {
    // Appending to `conversationMessages` would persist a per-request transport workaround into the
    // conversation, repeating it on every following round of the same turn.
    const before = HISTORY.length;
    const plan = applyStructuredOutputTransport(
      structuredOptions(),
      HISTORY,
      'test-model',
      resolvedWith(NO_SCHEMA_TABLE),
    );
    expect(HISTORY).toHaveLength(before);
    expect(plan.messages).not.toBe(HISTORY);
    expect(plan.messages).toHaveLength(before + 1);
  });

  it('leaves a non-structured request untouched and reports nothing', () => {
    const options: IChatOptions = { model: 'test-model' };
    const plan = applyStructuredOutputTransport(
      options,
      HISTORY,
      'test-model',
      resolvedWith(NO_SCHEMA_TABLE),
    );
    expect(plan.outcome).toBeUndefined();
    expect(plan.messages).toBe(HISTORY);
  });
});
