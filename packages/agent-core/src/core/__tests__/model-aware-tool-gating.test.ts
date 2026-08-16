/**
 * PROV-006 — a model that declares no tools is not offered any.
 *
 * The declaration carries this answer per MODEL and the execution seam asked a per-PROVIDER boolean,
 * so a reasoning model that verifiably lacks tools was handed the whole toolset. Nothing failed
 * loudly: the model either ignored them or the call errored at the vendor, which is the same
 * silence class as the rest of this audit.
 *
 * The contrast case matters as much as the gating one. Silence from a catalog is not a denial, and
 * a change that read it as one would have stripped tools from every model no catalog describes.
 *
 * `vision` is the same vocabulary and is NOT gated — see PROV-010. A first implementation refused
 * any turn whose outgoing messages carried an image, which is right about what gets sent and wrong
 * about what to do: `setModel()` preserves the conversation, so one image plus a model switch left
 * every later text-only turn refused for ever.
 */

import { describe, expect, it } from 'vitest';

import { AbstractAIProvider, AbstractTool } from '../../index';
import { Robota } from '../robota';

import type { IAgentConfig } from '../../interfaces/agent';
import type { TUniversalMessage } from '../../interfaces/messages';
import type { IChatOptions } from '../../interfaces/provider';
import type { IProviderCapabilityTable } from '../../interfaces/model-capability';
import type { IToolResult, TToolParameters } from '../../interfaces/tool';
import type { IToolSchema } from '../../interfaces/tool-schema';

const TABLE: IProviderCapabilityTable = {
  vendorDefault: ['tools', 'streaming'],
  deviations: {
    // The deepseek-reasoner shape: a model that verifiably lacks its vendor's tool support.
    'reasoning-model': { capabilities: ['reasoning', 'streaming'], verifiedAt: '2026-08-16' },
  },
  verifiedAt: '2026-08-16',
};

class CatalogProvider extends AbstractAIProvider {
  readonly name = 'catalog-provider';
  readonly version = '1.0.0';
  toolsOffered: Array<string[]> = [];

  capabilityTable(): IProviderCapabilityTable | undefined {
    return TABLE;
  }

  // Provider-granular and TRUE — this vendor does support function calling. The per-model answer is
  // the catalog's, and the two disagreeing for one model is exactly the deepseek defect.
  override supportsTools(): boolean {
    return true;
  }

  async chat(_messages: TUniversalMessage[], options?: IChatOptions): Promise<TUniversalMessage> {
    this.toolsOffered.push((options?.tools ?? []).map((tool) => tool.name));
    return {
      id: 'c1',
      role: 'assistant',
      content: 'done',
      state: 'complete' as const,
      timestamp: new Date(),
    };
  }
}

/** A provider that describes nothing about its models — the common case. */
class SilentCatalogProvider extends CatalogProvider {
  override readonly name = 'catalog-provider';

  override capabilityTable(): IProviderCapabilityTable | undefined {
    return undefined;
  }
}

class EchoTool extends AbstractTool {
  override get schema(): IToolSchema {
    return {
      name: 'echo_tool',
      description: 'echoes its input back',
      parameters: { type: 'object' as const, properties: {} },
    };
  }

  protected override async executeImpl(_parameters: TToolParameters): Promise<IToolResult> {
    return { success: true, data: {} };
  }
}

function buildAgent(provider: CatalogProvider, model: string): Robota {
  const config: IAgentConfig = {
    name: 'Capability Test Agent',
    aiProviders: [provider],
    defaultModel: { provider: 'catalog-provider', model },
    tools: [new EchoTool()],
    logging: { level: 'silent', enabled: false },
  };
  return new Robota(config);
}

describe('PROV-006 — per-model tool gating', () => {
  it('offers tools to a model whose catalog entry declares them', async () => {
    const provider = new CatalogProvider();
    await buildAgent(provider, 'chat-model').run('hello');

    expect(provider.toolsOffered[0]).toEqual(['echo_tool']);
  });

  it('offers NO tools to a model whose entry omits them, even though the provider says it can', async () => {
    // The defect, stated as the assertion: `supportsTools()` is true, the catalog says this model
    // has none, and the catalog is the one that knows.
    const provider = new CatalogProvider();
    expect(provider.supportsTools()).toBe(true);

    await buildAgent(provider, 'reasoning-model').run('hello');

    expect(provider.toolsOffered[0]).toEqual([]);
  });

  it('keeps offering tools when the catalog says nothing at all', async () => {
    // Silence is not denial. Without this, consuming the vocabulary would have taken tools away from
    // every model no catalog happens to describe — a far larger regression than the defect fixed.
    const provider = new SilentCatalogProvider();
    await buildAgent(provider, 'some-unlisted-model').run('hello');

    expect(provider.toolsOffered[0]).toEqual(['echo_tool']);
  });

  it('PROV-008 — a model with no deviation gets the vendor default, not a denial', async () => {
    // The rule that makes a short table safe. If absence from the deviation list meant "unknown" or
    // "incapable", every table would have to enumerate every model the vendor will ever ship.
    const provider = new CatalogProvider();
    await buildAgent(provider, 'a-model-nobody-listed').run('hello');

    expect(provider.toolsOffered[0]).toEqual(['echo_tool']);
  });
});
