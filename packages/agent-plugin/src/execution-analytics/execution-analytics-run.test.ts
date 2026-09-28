/**
 * During a real run, the analytics plugin records each tool call, a failed one included.
 */

import { describe, expect, it } from 'vitest';

import { FunctionTool, Robota } from '@robota-sdk/agent-core';
import { createScriptedProvider } from '@robota-sdk/agent-core/testing';

import { ExecutionAnalyticsPlugin } from './execution-analytics-plugin';

function tool(name: string, fn: () => Promise<string>): FunctionTool {
  return new FunctionTool(
    { name, description: name, parameters: { type: 'object', properties: {} } },
    fn,
  );
}

describe('ExecutionAnalyticsPlugin during a run', () => {
  it('records each tool call with whether it succeeded', async () => {
    const analytics = new ExecutionAnalyticsPlugin();
    const agent = new Robota({
      name: 'Analytics Agent',
      aiProviders: [
        createScriptedProvider([
          { toolCalls: [{ name: 'works', args: {} }] },
          { toolCalls: [{ name: 'breaks', args: {} }] },
          { text: 'done' },
        ]).provider,
      ],
      defaultModel: { provider: 'scripted-test-provider', model: 'test-model' },
      tools: [
        tool('works', async () => 'fine'),
        tool('breaks', async () => {
          throw new Error('it broke');
        }),
      ],
      plugins: [analytics],
      logging: { level: 'silent', enabled: false },
    });

    await agent.run('go');

    const toolCalls = analytics.getExecutionStats('tool-call');
    expect(toolCalls.map((call) => [call.metadata?.['toolName'], call.success])).toEqual([
      ['works', true],
      ['breaks', false],
    ]);
  });
});
