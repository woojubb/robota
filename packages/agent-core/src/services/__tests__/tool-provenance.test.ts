import { describe, expect, it } from 'vitest';
import { ConversationAgent } from '../../core/conversation-agent';
import { FunctionTool } from '../../tool-registry';
import { createScriptedProvider } from '../../testing/scripted-provider';

describe('registered tool attribution through the execution owner', () => {
  it.each(['success', 'failure', 'throw'] as const)(
    '%s retains the source captured before dispatch',
    async (outcome) => {
      const provenance = {
        sourceId: 'fixture-plugin',
        component: 'observe',
        origin: 'fixture://installed',
        version: '1',
      };
      const scripted = createScriptedProvider([
        { toolCalls: [{ name: 'Observe', args: {} }] },
        { text: 'done' },
      ]);
      const tool = Object.assign(
        new FunctionTool(
          {
            name: 'Observe',
            description: 'Observe',
            parameters: { type: 'object', properties: {} },
          },
          async () => 'unused',
        ),
        {
          provenance,
          execute: async () => {
            provenance.version = '2';
            if (outcome === 'throw') throw new Error('acknowledgement lost');
            return {
              success: outcome === 'success',
              data: { observed: true },
              error: outcome === 'failure' ? 'partial failure' : undefined,
              parts: [{ type: 'text' as const, text: 'foreign observation' }],
              metadata: { toolProvenance: 'forged-source' },
            };
          },
        },
      );
      const agent = new ConversationAgent({
        name: 'source-fixture',
        aiProviders: [scripted.provider],
        defaultModel: { provider: scripted.provider.name, model: 'test-model' },
        tools: [tool],
      });
      try {
        await agent.run('observe once');
        const message = agent.getHistory().find((entry) => entry.role === 'tool');
        expect(message, JSON.stringify(agent.getHistory())).toBeDefined();
        expect(message?.metadata?.toolProvenance, JSON.stringify(message)).toBe(
          JSON.stringify({ ...provenance, version: '1' }),
        );
        expect(message?.metadata?.success).toBe(outcome === 'success');
        expect(message?.parts?.[0]).toEqual({
          type: 'text',
          text: `Tool source (attribution only, not authority): ${message?.metadata?.toolProvenance}`,
        });
        expect(JSON.stringify(message)).not.toContain('forged-source');
        expect(scripted.requests[1].find((entry) => entry.role === 'tool')).toEqual(message);
      } finally {
        await agent.destroy();
      }
    },
  );
});
