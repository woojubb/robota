/**
 * PROV-006 — a model that declares no tools is not offered any.
 *
 * The catalog carried this answer per MODEL and the execution seam asked a per-PROVIDER boolean, so
 * a reasoning model whose own entry lists no `tools` was handed the whole toolset. Nothing failed
 * loudly: the model either ignored them or the call errored at the vendor, which is the same
 * silence class as the rest of this audit.
 *
 * The contrast case matters as much as the gating one. Silence from a catalog is not a denial, and
 * a change that read it as one would have stripped tools from every model no catalog describes.
 */

import { describe, expect, it } from 'vitest';

import { AbstractAIProvider, AbstractTool } from '../../index';
import { Robota } from '../robota';

import type { IAgentConfig } from '../../interfaces/agent';
import type { TUniversalMessage } from '../../interfaces/messages';
import type { IChatOptions } from '../../interfaces/provider';
import type { IProviderModelCatalog } from '../../interfaces/provider-definition';
import type { IToolResult, TToolParameters } from '../../interfaces/tool';
import type { IToolSchema } from '../../interfaces/tool-schema';

const CATALOG: IProviderModelCatalog = {
  status: 'fallback',
  entries: [
    { id: 'chat-model', displayName: 'Chat', capabilities: ['tools', 'vision', 'streaming'] },
    // The deepseek-reasoner shape: a populated list that deliberately omits `tools`.
    { id: 'reasoning-model', displayName: 'Reasoner', capabilities: ['reasoning', 'streaming'] },
  ],
};

const IMAGE_MESSAGE = {
  id: 'u1',
  role: 'user' as const,
  content: 'what is in this picture?',
  state: 'complete' as const,
  timestamp: new Date(),
  parts: [
    { type: 'text' as const, text: 'what is in this picture?' },
    { type: 'image_inline' as const, mimeType: 'image/png', data: 'AAAA' },
  ],
};

class CatalogProvider extends AbstractAIProvider {
  readonly name = 'catalog-provider';
  readonly version = '1.0.0';
  toolsOffered: Array<string[]> = [];

  modelCatalog(): IProviderModelCatalog | undefined {
    return CATALOG;
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

  override modelCatalog(): IProviderModelCatalog | undefined {
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

  it('keeps offering tools for a model the catalog does not list', async () => {
    const provider = new CatalogProvider();
    await buildAgent(provider, 'a-model-not-in-the-catalog').run('hello');

    expect(provider.toolsOffered[0]).toEqual(['echo_tool']);
  });
});

describe('PROV-006 — per-model vision gating', () => {
  it('refuses to send an image to a model whose entry omits `vision`, naming the model', async () => {
    // Sending it anyway produced either a vendor error the user cannot interpret or — worse — an
    // answer written as though the image had been read.
    const provider = new CatalogProvider();
    const agent = buildAgent(provider, 'reasoning-model');
    agent.injectRawMessage(IMAGE_MESSAGE);

    await expect(agent.run('describe it')).rejects.toThrow(/does not support images/);
    expect(provider.toolsOffered).toHaveLength(0);
  });

  it('sends it to a model that declares `vision`', async () => {
    const provider = new CatalogProvider();
    const agent = buildAgent(provider, 'chat-model');
    agent.injectRawMessage(IMAGE_MESSAGE);

    await expect(agent.run('describe it')).resolves.toBeDefined();
  });

  it('sends it when the catalog says nothing — silence is not a denial', async () => {
    const provider = new SilentCatalogProvider();
    const agent = buildAgent(provider, 'some-unlisted-model');
    agent.injectRawMessage(IMAGE_MESSAGE);

    await expect(agent.run('describe it')).resolves.toBeDefined();
  });

  it('a text-only request to the same model is unaffected', async () => {
    // The refusal is about the REQUEST carrying an image, not about the model being usable.
    const provider = new CatalogProvider();
    await expect(buildAgent(provider, 'reasoning-model').run('just text')).resolves.toBeDefined();
  });
});
