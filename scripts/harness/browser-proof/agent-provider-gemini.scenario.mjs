/**
 * agent-provider-gemini in a web-only realm: the request its client builds and sends through the
 * global `fetch`, and the message it reads back.
 */
import { GeminiProvider } from '@robota-sdk/agent-provider-gemini';

import { jsonResponse, userMessage } from './kit.mjs';

export default async function gemini(t) {
  t.fetch.on(':generateContent', () =>
    jsonResponse({
      candidates: [
        { content: { role: 'model', parts: [{ text: 'pong' }] }, finishReason: 'STOP', index: 0 },
      ],
      usageMetadata: { promptTokenCount: 3, candidatesTokenCount: 1, totalTokenCount: 4 },
    }),
  );
  const provider = new GeminiProvider({ apiKey: 'gemini-proof' });

  const reply = await provider.chat([userMessage('ping')], { model: 'gemini-proof' });
  const [request] = t.fetch.requests;
  t.equal(
    "the request goes to the model's generateContent method",
    [request?.method, request?.url],
    [
      'POST',
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-proof:generateContent',
    ],
  );
  t.equal('the request carries the key', request?.headers['x-goog-api-key'], 'gemini-proof');
  const sent = JSON.parse(request?.body ?? '{}');
  t.equal('the body carries the message', sent.contents, [
    { role: 'user', parts: [{ text: 'ping' }] },
  ]);
  t.equal(
    'the reply is the assistant message the endpoint returned',
    [reply.role, reply.content],
    ['assistant', 'pong'],
  );
}
