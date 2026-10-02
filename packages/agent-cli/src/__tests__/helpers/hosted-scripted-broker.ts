import type { hostedFixture } from '../../hosted/__tests__/hosted-fixture.js';

export interface IHostedBrokerReply {
  readonly tool?: { readonly name: string; readonly arguments: string };
  readonly content?: string;
}

/** Actual HTTP wire for both OpenAI surfaces; fixture task tokens only, never a live model. */
export function scriptedHostedBroker(
  fixture: Awaited<ReturnType<typeof hostedFixture>>,
  respond: (body: Record<string, unknown>, index: number) => IHostedBrokerReply,
) {
  const brokerCalls: Array<{ authorization?: string; body: Record<string, unknown> }> = [];
  fixture.setModelHandler(async (request, response) => {
    if (request.headers.authorization !== 'Bearer synthetic-task-token') {
      response.writeHead(401).end();
      return;
    }
    let raw = '';
    for await (const chunk of request) raw += String(chunk);
    const body = JSON.parse(raw) as Record<string, unknown>;
    brokerCalls.push({ authorization: request.headers.authorization, body });
    const usage = fixture.usage();
    fixture.setUsage({ ...usage, modelCalls: usage.modelCalls + 1,
      modelTokens: usage.modelTokens + 2, costMicros: usage.costMicros + 3 });
    const reply = respond(body, brokerCalls.length - 1);
    const tool = reply.tool;
    const content = reply.content ?? null;
    const message = {
      role: 'assistant',
      content,
      ...(tool
        ? {
            tool_calls: [{ id: `call-${brokerCalls.length}`, type: 'function', function: tool }],
          }
        : {}),
    };
    const finish = tool ? 'tool_calls' : 'stop';
    const common = { id: `completion-${brokerCalls.length}`, created: 1, model: 'gpt-test' };
    if (request.url === '/v1/responses') {
      const result = {
        id: `response-${brokerCalls.length}`,
        object: 'response',
        model: 'gpt-test',
        status: 'completed',
        created_at: 1,
        output: [
          tool
            ? {
                type: 'function_call',
                id: `fc-${brokerCalls.length}`,
                call_id: `call-${brokerCalls.length}`,
                name: tool.name,
                arguments: tool.arguments,
                status: 'completed',
              }
            : {
                type: 'message',
                id: `msg-${brokerCalls.length}`,
                role: 'assistant',
                status: 'completed',
                content: [{ type: 'output_text', text: content, annotations: [] }],
              },
        ],
        usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
      };
      if (body.stream === true) {
        response.writeHead(200, { 'content-type': 'text/event-stream' });
        if (content)
          response.write(
            `event: response.output_text.delta\ndata: ${JSON.stringify({ type: 'response.output_text.delta', delta: content })}\n\n`,
          );
        response.end(
          `event: response.completed\ndata: ${JSON.stringify({ type: 'response.completed', response: result })}\n\n`,
        );
      } else {
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(JSON.stringify(result));
      }
    } else if (body.stream === true) {
      response.writeHead(200, { 'content-type': 'text/event-stream' });
      const delta = {
        ...message,
        ...(tool
          ? {
              tool_calls: [
                {
                  index: 0,
                  id: `call-${brokerCalls.length}`,
                  type: 'function',
                  function: tool,
                },
              ],
            }
          : {}),
      };
      response.write(
        `data: ${JSON.stringify({ ...common, object: 'chat.completion.chunk', choices: [{ index: 0, delta, finish_reason: null }] })}\n\n`,
      );
      response.write(
        `data: ${JSON.stringify({ ...common, object: 'chat.completion.chunk', choices: [{ index: 0, delta: {}, finish_reason: finish }] })}\n\n`,
      );
      response.end('data: [DONE]\n\n');
    } else {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(
        JSON.stringify({
          ...common,
          object: 'chat.completion',
          choices: [{ index: 0, message, finish_reason: finish }],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        }),
      );
    }
  });
  return brokerCalls;
}
