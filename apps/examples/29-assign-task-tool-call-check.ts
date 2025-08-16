import 'dotenv/config';
import { Robota } from '@robota-sdk/agents';
import { OpenAIProvider } from '@robota-sdk/openai';
import { createAssignTaskDummyTool } from '@robota-sdk/team';

async function main() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('[STRICT-POLICY] Missing OPENAI_API_KEY');
  const provider = new OpenAIProvider({ apiKey, model: 'gpt-4o-mini' });
  const assignTask = createAssignTaskDummyTool();

  const agent = new Robota({
    name: 'DummyToolAgent',
    systemPrompt: 'You are an assistant. If asked to research, you MUST call the assignTask tool.',
    aiProviders: [provider],
    defaultModel: { provider: 'openai', model: 'gpt-4o-mini' },
    tools: [assignTask]
  });

  const prompt = 'vue와 react를 각각 조사해서 100자 이내로 요약\n* tool 호출 필수';
  const res = await agent.run(prompt);
  console.log('Final response:', res);
}

main().catch((e) => { console.error(e); process.exit(1); });


