/**
 * A loopback OpenAI-compatible chat-completions endpoint whose replies a test scripts, so the
 * personal agent runs end to end without a real model or credential. Every request is recorded, so a
 * test can assert which tools were offered and what the model was shown.
 */
import { createServer } from 'node:http';

import type { AddressInfo } from 'node:net';

export interface IModelRequest {
  readonly messages: readonly { role: string; content: unknown; tool_calls?: unknown }[];
  readonly tools?: readonly { function?: { name?: string } }[];
}

export type TModelReply =
  | { readonly text: string }
  | { readonly tool: string; readonly args: Record<string, unknown> };

export interface IScriptedModel {
  readonly baseURL: string;
  readonly requests: IModelRequest[];
  /** Replies are taken in order; the last one repeats. A function reply sees the request. */
  script(...replies: (TModelReply | ((request: IModelRequest) => TModelReply))[]): void;
  close(): Promise<void>;
}

export function offeredTools(request: IModelRequest): string[] {
  return (request.tools ?? []).map((tool) => tool.function?.name ?? '').filter((name) => name !== '');
}

export function toolResults(request: IModelRequest): string[] {
  return request.messages.filter((message) => message.role === 'tool').map((message) => String(message.content));
}

export async function startScriptedModel(): Promise<IScriptedModel> {
  const requests: IModelRequest[] = [];
  let replies: (TModelReply | ((request: IModelRequest) => TModelReply))[] = [{ text: 'OK' }];
  let next = 0;
  let round = 0;
  const server = createServer(async (req, res) => {
    if (req.method !== 'POST' || req.url !== '/v1/chat/completions') {
      res.writeHead(404).end();
      return;
    }
    let raw = '';
    for await (const chunk of req) raw += String(chunk);
    const body = JSON.parse(raw) as IModelRequest & { stream?: boolean };
    requests.push(body);
    const entry = replies[Math.min(next, replies.length - 1)]!;
    next += 1;
    const reply = typeof entry === 'function' ? entry(body) : entry;
    round += 1;
    const message =
      'text' in reply
        ? { role: 'assistant', content: reply.text }
        : {
            role: 'assistant',
            content: null,
            tool_calls: [
              { index: 0, id: `call-${round}`, type: 'function', function: { name: reply.tool, arguments: JSON.stringify(reply.args) } },
            ],
          };
    const finish = 'text' in reply ? 'stop' : 'tool_calls';
    const streaming = body.stream === true;
    const chunk = {
      id: `reply-${round}`,
      object: streaming ? 'chat.completion.chunk' : 'chat.completion',
      created: 1,
      model: 'scripted-model',
      choices: [{ index: 0, ...(streaming ? { delta: message } : { message }), finish_reason: finish }],
    };
    if (!streaming) {
      res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(chunk));
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    res.end(`data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const port = (server.address() as AddressInfo).port;
  return {
    baseURL: `http://127.0.0.1:${port}/v1`,
    requests,
    script(...scripted) {
      replies = scripted;
      next = 0;
    },
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}
