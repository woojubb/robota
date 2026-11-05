/**
 * agent-provider-openai-compatible in a web-only realm, through its DeepSeek provider: the request
 * the shared OpenAI-compatible builder produces, sent through the global `fetch`.
 */
import {
  DEFAULT_DEEPSEEK_PROVIDER_BASE_URL,
  DeepSeekProvider,
} from '@robota-sdk/agent-provider-openai-compatible';

import { jsonResponse, userMessage } from './kit.mjs';

export default async function openaiCompatible(t) {
  t.fetch.on('/chat/completions', () =>
    jsonResponse({
      id: 'chatcmpl-proof',
      object: 'chat.completion',
      created: 1,
      model: 'deepseek-proof',
      choices: [
        { index: 0, message: { role: 'assistant', content: 'pong' }, finish_reason: 'stop' },
      ],
      usage: { prompt_tokens: 3, completion_tokens: 1, total_tokens: 4 },
    }),
  );
  const provider = new DeepSeekProvider({ apiKey: 'sk-proof' });

  const reply = await provider.chat([userMessage('ping')], { model: 'deepseek-proof' });
  const [request] = t.fetch.requests;
  t.equal(
    "the request goes to the provider's own base URL",
    [request?.method, request?.url],
    ['POST', `${DEFAULT_DEEPSEEK_PROVIDER_BASE_URL.replace(/\/$/, '')}/chat/completions`],
  );
  t.equal(
    'the request carries the key as a bearer token',
    request?.headers.authorization,
    'Bearer sk-proof',
  );
  const sent = JSON.parse(request?.body ?? '{}');
  t.equal(
    'the body names the model and carries the message',
    [sent.model, sent.messages],
    ['deepseek-proof', [{ role: 'user', content: 'ping' }]],
  );
  t.equal(
    'the reply is the assistant message the endpoint returned',
    [reply.role, reply.content],
    ['assistant', 'pong'],
  );
}
