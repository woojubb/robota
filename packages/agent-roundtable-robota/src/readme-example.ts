import { ConversationAgent, type IAIProvider } from '@robota-sdk/agent-core';
import { createRoundtable, MemoryConversationStore } from '@robota-sdk/agent-roundtable';
import { runtimeParticipant } from './index';

// A minimal provider so this example runs with no external service or API key.
const provider: IAIProvider = {
  name: 'demo-provider',
  version: '1',
  async chat(messages) {
    const latest = messages.at(-1)?.content ?? '';
    return {
      id: 'demo-1',
      role: 'assistant',
      content: `echo: ${latest}`,
      state: 'complete',
      timestamp: new Date(),
    };
  },
  async generateResponse() {
    return { content: '' };
  },
  supportsTools: () => false,
  validateConfig: () => true,
};

const assistant = runtimeParticipant({
  id: 'assistant',
  runtime: { id: 'demo/conversation-agent', version: '1' },
  createAgent: async () =>
    new ConversationAgent({
      name: 'assistant',
      aiProviders: [provider],
      defaultModel: { provider: provider.name, model: 'demo-model' },
    }),
});

export async function runQuickstart() {
  const room = createRoundtable({
    conversationId: 'quickstart',
    store: new MemoryConversationStore(),
    participants: [assistant],
    limits: { maxTurnsPerRun: 1 },
  });
  const result = await room.run();
  const messages = room.snapshot().messages;
  await room.dispose();
  return { result, messages };
}
