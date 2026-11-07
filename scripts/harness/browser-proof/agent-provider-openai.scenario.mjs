/**
 * agent-provider-openai in a web-only realm: the request its client builds and sends through the
 * global `fetch`, for a plain reply and for a streamed one.
 */
import { OpenAIProvider } from '@robota-sdk/agent-provider-openai';

import { jsonResponse, sseResponse, userMessage } from './kit.mjs';

const chunk = (delta, finish = null) => ({
  id: 'chatcmpl-proof',
  object: 'chat.completion.chunk',
  created: 1,
  model: 'gpt-proof',
  choices: [{ index: 0, delta, finish_reason: finish }],
});

export default async function openai(t) {
  t.fetch.on('/chat/completions', ({ body }) =>
    JSON.parse(body).stream === true
      ? sseResponse([
          { data: chunk({ role: 'assistant', content: 'po' }) },
          { data: chunk({ content: 'ng' }) },
          { data: chunk({}, 'stop') },
          { data: '[DONE]' },
        ])
      : jsonResponse({
          id: 'chatcmpl-proof',
          object: 'chat.completion',
          created: 1,
          model: 'gpt-proof',
          choices: [
            { index: 0, message: { role: 'assistant', content: 'pong' }, finish_reason: 'stop' },
          ],
          usage: { prompt_tokens: 3, completion_tokens: 1, total_tokens: 4 },
        }),
  );
  const provider = new OpenAIProvider({ apiKey: 'sk-proof', apiSurface: 'chat-completions' });

  const reply = await provider.chat([userMessage('ping')], { model: 'gpt-proof' });
  const [request] = t.fetch.requests;
  t.equal(
    'the request goes to the chat completions endpoint',
    [request?.method, request?.url],
    ['POST', 'https://api.openai.com/v1/chat/completions'],
  );
  t.equal(
    'the request carries the key as a bearer token',
    request?.headers.authorization,
    'Bearer sk-proof',
  );
  t.match('the request is JSON', request?.headers['content-type'] ?? '', 'application/json');
  const sent = JSON.parse(request?.body ?? '{}');
  t.equal(
    'the body names the model and carries the message',
    [sent.model, sent.messages],
    ['gpt-proof', [{ role: 'user', content: 'ping' }]],
  );
  t.equal(
    'the reply is the assistant message the endpoint returned',
    [reply.role, reply.content],
    ['assistant', 'pong'],
  );

  const deltas = [];
  provider.onTextDelta = (delta) => deltas.push(delta);
  const streamed = await provider.chat([userMessage('ping')], { model: 'gpt-proof' });
  t.equal(
    'a streamed reply asks for a stream',
    JSON.parse(t.fetch.requests[1]?.body ?? '{}').stream,
    true,
  );
  t.equal('the deltas arrive in order', deltas, ['po', 'ng']);
  t.equal('the assembled message is the whole text', streamed.content, 'pong');
}
