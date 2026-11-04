/**
 * agent-provider-anthropic in a web-only realm: the request its client builds and sends through
 * the global `fetch`, and the message it assembles from the event stream that answers. The provider
 * always streams, so the endpoint answers with server-sent events.
 */
import { AnthropicProvider } from '@robota-sdk/agent-provider-anthropic';

import { sseResponse, userMessage } from './kit.mjs';

export default async function anthropic(t) {
  const message = {
    id: 'msg_proof',
    type: 'message',
    role: 'assistant',
    model: 'claude-proof',
    content: [],
    stop_reason: null,
    stop_sequence: null,
    usage: { input_tokens: 3, output_tokens: 0 },
  };
  const event = (name, data) => ({ event: name, data: { type: name, ...data } });
  t.fetch.on('/v1/messages', () =>
    sseResponse([
      event('message_start', { message }),
      event('content_block_start', { index: 0, content_block: { type: 'text', text: '' } }),
      event('content_block_delta', { index: 0, delta: { type: 'text_delta', text: 'po' } }),
      event('content_block_delta', { index: 0, delta: { type: 'text_delta', text: 'ng' } }),
      event('content_block_stop', { index: 0 }),
      event('message_delta', {
        delta: { stop_reason: 'end_turn', stop_sequence: null },
        usage: { output_tokens: 1 },
      }),
      event('message_stop', {}),
    ]),
  );
  const provider = new AnthropicProvider({ apiKey: 'sk-ant-proof' });

  const deltas = [];
  const reply = await provider.chat([userMessage('ping')], {
    model: 'claude-proof',
    onTextDelta: (delta) => deltas.push(delta),
  });
  const [request] = t.fetch.requests;
  t.equal(
    'the request goes to the messages endpoint',
    [request?.method, request?.url],
    ['POST', 'https://api.anthropic.com/v1/messages'],
  );
  t.equal('the request carries the key', request?.headers['x-api-key'], 'sk-ant-proof');
  t.ok('the request names an API version', Boolean(request?.headers['anthropic-version']));
  t.match('the request is JSON', request?.headers['content-type'] ?? '', 'application/json');
  const sent = JSON.parse(request?.body ?? '{}');
  t.equal(
    'the body names the model and carries the message',
    [sent.model, sent.messages],
    ['claude-proof', [{ role: 'user', content: 'ping' }]],
  );
  t.ok('the body bounds the reply', Number.isInteger(sent.max_tokens) && sent.max_tokens > 0);
  t.equal('the request asks for a stream', sent.stream, true);
  t.equal('the deltas arrive in order', deltas, ['po', 'ng']);
  t.equal(
    'the reply is the message assembled from the stream',
    [reply.role, reply.content],
    ['assistant', 'pong'],
  );
}
