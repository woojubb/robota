import { describe, expect, it, vi } from 'vitest';
import { Robota } from './robota';
import { AbstractTool } from '../abstracts/abstract-tool';
import type { IToolSchema } from '../interfaces/provider';
import { FunctionTool } from '../tool-registry/function-tool';
import type { IToolResult } from '../interfaces/tool';
import type { IAIProvider } from '../interfaces/provider';

describe('canonical runtime tools', () => {
  it('lists and invokes registered deferred tools without a model turn or loading them for the model', async () => {
    const chat = vi.fn<IAIProvider['chat']>();
    const agent = new Robota({
      name: 'runtime-test',
      aiProviders: [
        {
          name: 'test',
          version: '1',
          chat,
          generateResponse: vi.fn<IAIProvider['generateResponse']>(),
          supportsTools: () => true,
          validateConfig: () => true,
        },
      ],
      defaultModel: { provider: 'test', model: 'test' },
      toolSearch: 'on',
      tools: [
        new FunctionTool(
          {
            name: 'ToolSearch',
            description: 'Search',
            parameters: { type: 'object', properties: {} },
          },
          async (_args, context) =>
            context?.deferredTools?.listDeferredTools().map((tool) => tool.name) ?? [],
        ),
        new FunctionTool(
          {
            name: 'deferred',
            description: 'A deferred tool',
            deferLoading: true,
            parameters: { type: 'object', properties: {} },
          },
          async () => 'done',
        ),
      ],
      logging: { enabled: false },
    });
    try {
      expect((await agent.listRuntimeTools()).map((tool) => tool.name)).toEqual([
        'ToolSearch',
        'deferred',
      ]);
      expect(agent.getOfferedToolSchemas().map((tool) => tool.name)).toEqual(['ToolSearch']);
      expect(
        await agent.invokeRuntimeTool(
          'deferred',
          {},
          { toolName: 'deferred', parameters: {}, executionId: 'direct-1' },
        ),
      ).toMatchObject({ success: true, result: 'done', executionId: 'direct-1' });
      expect(agent.getOfferedToolSchemas().map((tool) => tool.name)).toEqual(['ToolSearch']);
      expect(
        await agent.invokeRuntimeTool(
          'ToolSearch',
          {},
          { toolName: 'ToolSearch', parameters: {}, executionId: 'search-1' },
        ),
      ).toMatchObject({ success: true, result: ['deferred'] });
      expect(chat).not.toHaveBeenCalled();
      expect(agent.getHistory()).toEqual([]);
      expect(
        await agent.invokeRuntimeTool(
          'absent',
          {},
          { toolName: 'absent', parameters: {}, executionId: 'direct-2' },
        ),
      ).toMatchObject({ success: false, metadata: { errorCode: 'unknown_tool' } });
    } finally {
      await agent.destroy();
    }
  });
});

class DeniedTool extends AbstractTool {
  constructor(readonly schema: IToolSchema) {
    super();
  }
  protected override async executeImpl(): Promise<IToolResult> {
    return { success: false, error: 'permission denied', data: 'denied' };
  }
}

it('preserves failed tool envelopes on initial, additional and replacement registration', async () => {
  const tool = (name: string): DeniedTool =>
    new DeniedTool({ name, description: 'Denied', parameters: { type: 'object', properties: {} } });
  const agent = new Robota({
    name: 'denied-test',
    aiProviders: [
      {
        name: 'test',
        version: '1',
        chat: vi.fn<IAIProvider['chat']>(),
        generateResponse: vi.fn<IAIProvider['generateResponse']>(),
        supportsTools: () => true,
        validateConfig: () => true,
      },
    ],
    defaultModel: { provider: 'test', model: 'test' },
    tools: [tool('initial')],
    logging: { enabled: false },
  });
  const invoke = (name: string) =>
    agent.invokeRuntimeTool(name, {}, { toolName: name, parameters: {}, executionId: name });
  try {
    expect(await invoke('initial')).toMatchObject({
      success: false,
      error: expect.stringContaining('permission denied'),
    });
    agent.registerTool(tool('additional'));
    expect(await invoke('additional')).toMatchObject({
      success: false,
      error: expect.stringContaining('permission denied'),
    });
    await agent.updateTools([tool('replacement')]);
    expect(await invoke('replacement')).toMatchObject({
      success: false,
      error: expect.stringContaining('permission denied'),
    });
    expect((await agent.listRuntimeTools()).map((schema) => schema.name)).toEqual(['replacement']);
  } finally {
    await agent.destroy();
  }
});
