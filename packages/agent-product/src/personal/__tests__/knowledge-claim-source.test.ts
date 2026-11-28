import { afterEach, describe, expect, it } from 'vitest';

import { ConversationAgent } from '@robota-sdk/agent-core';
import { createScriptedProvider } from '@robota-sdk/agent-core/testing';

import { KnowledgeWiki, createMemoryKnowledgeStore, createWikiTools } from '../index.js';

const agents: ConversationAgent[] = [];
afterEach(async () => {
  await Promise.all(agents.splice(0).map((agent) => agent.destroy()));
});

/** An agent whose scripted model saves one claim through the real wiki tool. */
function savingAgent(wiki: KnowledgeWiki): ConversationAgent {
  const scripted = createScriptedProvider([
    {
      toolCalls: [
        {
          name: 'WikiRemember',
          args: { page: 'Mina', kind: 'person', claim: 'Mina drinks green tea', origin: 'owner' },
        },
      ],
    },
    { text: 'saved' },
  ]);
  const agent = new ConversationAgent({
    name: 'wiki-source-test',
    aiProviders: [scripted.provider],
    defaultModel: { provider: scripted.provider.name, model: 'test-model' },
    tools: createWikiTools(wiki),
    logging: { level: 'silent', enabled: false },
  });
  agents.push(agent);
  return agent;
}

describe('a claim the model saves', () => {
  it('records the session of the conversation it came from', async () => {
    const wiki = new KnowledgeWiki({ store: createMemoryKnowledgeStore() });
    await savingAgent(wiki).run('Mina drinks green tea', { sessionId: 'session-42' });
    const page = await wiki.read('mina');
    expect(page?.claims[0]?.source).toMatchObject({ origin: 'owner', sessionId: 'session-42' });
  });
});
