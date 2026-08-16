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

import type { IProviderCapabilityTable } from '../../interfaces/model-capability';
import type { TUniversalMessage } from '../../interfaces/messages';
import type { IAIProvider, IChatOptions } from '../../interfaces/provider';

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

  capabilityTable(): IProviderCapabilityTable {
    return NO_SCHEMA_TABLE;
  }

  async chat(messages: TUniversalMessage[], _options: IChatOptions): Promise<TUniversalMessage> {
    this.received = messages;
    return {
      id: 'a1',
      role: 'assistant',
      content: JSON.stringify({ ok: true }),
      timestamp: new Date(),
      state: 'complete',
    };
  }

  async *chatStream(): AsyncGenerator<TUniversalMessage> {
    throw new Error('unused');
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
});
