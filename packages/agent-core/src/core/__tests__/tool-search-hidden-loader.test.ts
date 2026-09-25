import { describe, expect, it } from 'vitest';

import { TOOL_SEARCH_TOOL_NAME } from '../../interfaces/tool-search';
import { createConfiguredTools } from '../robota-construction';

import type { IAgentConfig } from '../../interfaces/agent';
import type { IToolSchema } from '../../interfaces/provider';

function schema(name: string, deferLoading = false): IToolSchema {
  return {
    name,
    description: `${name} tool`,
    parameters: { type: 'object', properties: {} },
    ...(deferLoading ? { deferLoading: true } : {}),
  };
}

/**
 * Issue #3081 — a bare-name deny on the loader must not leave withheld schemas nobody can load.
 */
describe('tool search with the loader hidden by a deny rule', () => {
  it('turns deferral off, so the visible deferred tools are offered resident', async () => {
    const config = {
      name: 'agent',
      aiProviders: [],
      defaultModel: { provider: 'p', model: 'm' },
      toolSearch: 'on',
      isToolVisible: (name: string) => name !== TOOL_SEARCH_TOOL_NAME,
    } as unknown as IAgentConfig;
    const tools = createConfiguredTools(() => config);
    await tools.initialize();
    tools.addTool(schema('Read'), async () => 'ok');
    tools.addTool(schema(TOOL_SEARCH_TOOL_NAME), async () => 'ok');
    tools.addTool(schema('Remote', true), async () => 'ok');

    expect(tools.getOfferedTools().map((tool) => tool.name)).toEqual(['Read', 'Remote']);
    await tools.dispose();
  });
});
