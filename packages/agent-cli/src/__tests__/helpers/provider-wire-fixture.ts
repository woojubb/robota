/** Deterministic loopback responses through native SDK adapters; no live model requests. */
import type { ServerResponse } from 'node:http';

export type Provider = 'anthropic' | 'openai';
type WireMessage = { role: string; content?: unknown; tool_call_id?: string };
export type WireRequest = {
  stream?: boolean;
  messages: WireMessage[];
  tools?: { name?: string; function?: { name?: string } }[];
};
export type Step = { id: string; name: string; args: Record<string, string | number> };
export function wireReceipts(
  provider: Provider,
  request: WireRequest,
): { id: string; content: unknown; failed?: boolean }[] {
  if (provider === 'openai')
    return request.messages
      .filter((message) => message.role === 'tool')
      .map((message) => ({ id: String(message.tool_call_id), content: message.content }));
  return request.messages.flatMap((message) =>
    Array.isArray(message.content)
      ? message.content
          .filter((block) => block.type === 'tool_result')
          .map((block) => ({
            id: String(block.tool_use_id),
            content: block.content,
            failed: block.is_error === true,
          }))
      : [],
  );
}

/** Return protocol-shaped fixture responses through the SDK, rather than replacing the provider. */
export function respond(
  provider: Provider,
  response: ServerResponse,
  streaming: boolean,
  round: number,
  step?: Step | Step[],
  finalContent = 'Done',
): void {
  const steps = step === undefined ? [] : Array.isArray(step) ? step : [step];
  const hasTools = steps.length > 0;
  if (provider === 'openai') {
    const toolCalls = hasTools
      ? steps.map((entry, index) => ({
            index,
            id: entry.id,
            type: 'function',
            function: { name: entry.name, arguments: JSON.stringify(entry.args) },
          }))
      : undefined;
    const message = {
      role: 'assistant',
      content: hasTools ? null : finalContent,
      ...(toolCalls ? { tool_calls: toolCalls } : {}),
    };
    const chunk = {
      id: `reply-${round}`,
      object: streaming ? 'chat.completion.chunk' : 'chat.completion',
      created: 1,
      model: 'fixture-model',
      choices: [
        {
          index: 0,
          ...(streaming ? { delta: message } : { message }),
          finish_reason: hasTools ? 'tool_calls' : 'stop',
        },
      ],
    };
    if (!streaming) {
      response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(chunk));
      return;
    }
    response.writeHead(200, { 'Content-Type': 'text/event-stream' });
    response.end(`data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`);
    return;
  }
  const events = [
    {
      type: 'message_start',
      message: {
        id: `reply-${round}`,
        type: 'message',
        role: 'assistant',
        model: 'fixture-model',
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: 1, output_tokens: 0 },
      },
    },
    ...(hasTools ? steps : [undefined]).flatMap((entry, index) => [
    {
      type: 'content_block_start',
      index,
      content_block: entry
        ? { type: 'tool_use', id: entry.id, name: entry.name, input: {} }
        : { type: 'text', text: '' },
    },
    {
      type: 'content_block_delta',
      index,
      delta: entry
        ? { type: 'input_json_delta', partial_json: JSON.stringify(entry.args) }
        : { type: 'text_delta', text: finalContent },
    },
    { type: 'content_block_stop', index },
    ]),
    {
      type: 'message_delta',
      delta: { stop_reason: hasTools ? 'tool_use' : 'end_turn', stop_sequence: null },
      usage: { output_tokens: 1 },
    },
    { type: 'message_stop' },
  ];
  response.writeHead(200, { 'Content-Type': 'text/event-stream' });
  response.end(
    events.map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(''),
  );
}
