/**
 * CORE-043: `provider_request` must describe the request that was actually sent.
 *
 * The event was emitted BEFORE the provider call, carrying the caller's `conversationMessages`. The
 * structured-output transport guard adds a system instruction that array does not contain — so for a
 * provider with no schema parameter, the session log recorded a request the model never received,
 * and a replay driven from that log could not reproduce the turn.
 *
 * This drives a real `Robota` turn rather than calling the round helper directly, because the defect
 * lives in the ORDER of two calls in `execution-round-streaming.ts`: emit, then assemble. A test that
 * calls the assembler cannot see that ordering, which is exactly why the emit path had no guard.
 */

import { describe, expect, it } from 'vitest';

import { Robota } from '../../core/robota';
import { FunctionTool } from '../../tool-registry';

import type { IProviderCapabilityTable } from '../../interfaces/model-capability';
import type { TUniversalMessage } from '../../interfaces/messages';
import type { IAIProvider, IChatOptions, IToolSchema } from '../../interfaces/provider';

/** A parameterless object schema — these tools are never executed, only offered. */
const OBJECT_PARAMS: IToolSchema['parameters'] = { type: 'object', properties: {} };

/** A populated table that omits every schema capability — a genuine denial, so the prompt is used. */
const NO_SCHEMA_TABLE: IProviderCapabilityTable = {
  vendorDefault: ['tools', 'streaming'],
  verifiedAt: '2026-01-01',
};

// Structurally typed rather than `implements IAIProvider`: the full contract carries raw-payload
// members this scenario never reaches, and stubbing them would add noise that asserts nothing. The
// agent reads the members used below.
class NoSchemaProvider {
  readonly name = 'no-schema';
  readonly version = '1.0.0';
  received: TUniversalMessage[] = [];
  /** CLI-1990: the wire options, so a case can compare the logged envelope against what was sent. */
  receivedOptions: IChatOptions | undefined;

  capabilityTable(): IProviderCapabilityTable {
    return NO_SCHEMA_TABLE;
  }

  async chat(messages: TUniversalMessage[], options: IChatOptions): Promise<TUniversalMessage> {
    this.received = messages;
    this.receivedOptions = options;
    return {
      id: 'a1',
      role: 'assistant',
      content: JSON.stringify({ ok: true }),
      timestamp: new Date(),
      state: 'complete',
    };
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async *chatStream(): AsyncGenerator<TUniversalMessage> {
    // This scenario drives the non-streaming path; a generator that yields nothing is the honest
    // stub, and reaching it would be a routing bug worth seeing rather than a silent no-op.
    yield* [];
    throw new Error('chatStream is not exercised by this scenario');
  }

  supportsTools(): boolean {
    return true;
  }

  validateConfig(): boolean {
    return true;
  }

  async dispose(): Promise<void> {}
}

describe('CORE-043 — provider_request describes what was sent', () => {
  it('carries the schema instruction the transport guard added', async () => {
    const provider = new NoSchemaProvider();
    const events: Array<{ event: string; data: Record<string, unknown> }> = [];
    const agent = new Robota({
      name: 'provider-request-event',
      aiProviders: [provider as unknown as IAIProvider],
      defaultModel: { provider: 'no-schema', model: 'some-model' },
    });

    try {
      await agent.run('anything', {
        // A schema the provider cannot be handed as a parameter, so it must travel in the prompt.
        output: {
          name: 'Ok',
          jsonSchema: {
            type: 'object',
            properties: { ok: { type: 'boolean' } },
            required: ['ok'],
          },
        },
        onExecutionEvent: (event, data) =>
          events.push({ event, data: data as Record<string, unknown> }),
      });

      const request = events.find((entry) => entry.event === 'provider_request');
      expect(request).toBeDefined();

      const logged = request?.data['messages'] as TUniversalMessage[] | undefined;
      // The assertion that goes red when the emit moves back ahead of the assembly: the logged
      // messages ARE the ones the provider received, instruction included.
      expect(logged).toEqual(provider.received);
      expect(logged?.at(-1)?.role).toBe('system');
      expect(String(logged?.at(-1)?.content)).toContain('matching this JSON schema');
    } finally {
      await agent.destroy();
    }
  });

  it('DATA-2577 assigns one stable usage identity to each provider round', async () => {
    const provider = new NoSchemaProvider();
    const agent = new Robota({
      name: 'usage-observation-identity',
      aiProviders: [provider as unknown as IAIProvider],
      defaultModel: { provider: 'no-schema', model: 'some-model' },
    });

    try {
      await agent.run('anything');
      const assistant = agent.getHistory().find((message) => message.role === 'assistant');
      expect(assistant?.metadata).toMatchObject({
        providerId: 'no-schema',
        modelId: 'some-model',
        round: 1,
      });
      expect(assistant?.metadata?.['usageObservationId']).toEqual(expect.any(String));
      expect(assistant?.metadata?.['executionId']).toEqual(expect.any(String));
    } finally {
      await agent.destroy();
    }
  });

  /**
   * CLI-1990 TC-08 — the same rule, now applied to `tools`.
   *
   * The event logged `resolved.availableTools`, the array the round was ASSEMBLED from. That already
   * diverged from the wire whenever the model-capability guard removed the tools, and residency
   * makes the gap routine: the request carries the offered projection, not the registry. A replay
   * driven from an envelope describing tools the model was never shown cannot reproduce the turn.
   */
  it('TC-08: carries the tools actually sent, not the registry the round was assembled from', async () => {
    const provider = new NoSchemaProvider();
    const events: Array<{ event: string; data: Record<string, unknown> }> = [];
    const agent = new Robota({
      name: 'provider-request-event-tools',
      aiProviders: [provider as unknown as IAIProvider],
      defaultModel: { provider: 'no-schema', model: 'some-model' },
      toolSearch: 'on',
      tools: [
        new FunctionTool(
          { name: 'resident_tool', description: 'resident', parameters: OBJECT_PARAMS },
          async () => 'ok',
        ),
        new FunctionTool(
          {
            name: 'deferred_tool',
            description: 'deferred',
            parameters: OBJECT_PARAMS,
            deferLoading: true,
          },
          async () => 'ok',
        ),
      ],
    });

    try {
      await agent.run('anything', {
        onExecutionEvent: (event, data) =>
          events.push({ event, data: data as Record<string, unknown> }),
      });

      const logged = events.find((entry) => entry.event === 'provider_request')?.data['tools'] as
        IToolSchema[] | undefined;

      // The envelope IS the wire.
      expect(logged).toEqual(provider.receivedOptions?.tools);
      // And the wire is the offered projection: residency removed one tool, so an envelope logging
      // the registry would carry `deferred_tool` here. That is this case's RED condition.
      expect(logged?.map((tool) => tool.name)).toEqual(['resident_tool']);
      expect(agent.getOfferedToolSchemas().map((tool) => tool.name)).toEqual(['resident_tool']);
    } finally {
      await agent.destroy();
    }
  });
});
