import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

import type { TJson } from './outcome-coding-protocol.js';
import type { TUpstream } from './outcome-coding-relay.js';

/**
 * A loopback gateway with no network and no cost, for the driver's dry run and its tests. It
 * answers the four requests a paid run makes (catalog, endpoint listing, credits, chat completion)
 * in the shape the real checks assume, and shows each chat request to a reply source the caller
 * sets, then adds the receipt fields (`usage.cost`, `provider`, `model`) the way the live gateway is
 * expected to. A behavior hook can break any single call on purpose.
 */

export type TFakeChatBehavior =
  | {
      readonly kind: 'receipt';
      /** Top-level fields replaced in the reply (for example a different provider). */
      readonly patch?: Record<string, unknown>;
      /** Usage fields replaced in the reply (for example a larger cost). */
      readonly usage?: Record<string, unknown>;
    }
  | { readonly kind: 'status'; readonly status: number }
  | { readonly kind: 'hang' }
  | { readonly kind: 'destroy' };

export interface IFakeGatewayOptions {
  readonly model: string;
  readonly provider: string;
  /** Cost in dollars reported on every successful reply. */
  readonly costUsd?: number;
}

export interface IFakeGateway {
  /** Base URL of the API; the chat endpoint is `<base>/chat/completions`. */
  base: string;
  endpoint: string;
  readonly chatBodies: string[];
  readonly chatAuth: (string | undefined)[];
  readonly allPaths: string[];
  /** Decides how the n-th chat request (from 0) is answered; the default is a normal receipt. */
  behavior: (callIndex: number) => TFakeChatBehavior;
  /** Produces the reply content for a chat request; without one the reply is a short text. */
  source: TUpstream | undefined;
  listing: unknown;
  credits: unknown;
  close(): Promise<void>;
}

/** An endpoint listing with a headline price and a higher regional one: the basis must cover the highest. */
export function fakeListing(provider: string): TJson {
  return {
    data: {
      endpoints: [
        { provider_name: provider, pricing: { prompt: '0.0000003', completion: '0.0000012' } },
        {
          provider_name: provider,
          pricing: { prompt: '0.0000003', completion: '0.0000012' },
          regions: [{ pricing: { prompt: '0.0000004', completion: '0.0000015' } }],
        },
        { provider_name: 'other-route', pricing: { prompt: '1', completion: '1' } },
      ],
    },
  };
}

function json(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { 'content-type': 'application/json' });
  response.end(JSON.stringify(body));
}

export async function startFakeGateway(options: IFakeGatewayOptions): Promise<IFakeGateway> {
  const gateway: IFakeGateway = {
    base: '',
    endpoint: '',
    chatBodies: [],
    chatAuth: [],
    allPaths: [],
    behavior: () => ({ kind: 'receipt' }),
    source: undefined,
    listing: fakeListing(options.provider),
    credits: { data: { total_credits: 5, total_usage: 1.5 } },
    close: async () => undefined,
  };
  const modelPath = `/v1/models/${options.model.split('/').map(encodeURIComponent).join('/')}/endpoints`;
  const server: Server = createServer((request: IncomingMessage, response: ServerResponse) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => {
      void (async () => {
        const path = request.url ?? '';
        gateway.allPaths.push(`${request.method} ${path}`);
        if (request.method === 'GET' && path === '/v1/models') {
          return json(response, 200, { data: [{ id: options.model }, { id: 'other-model' }] });
        }
        if (request.method === 'GET' && path === modelPath)
          return json(response, 200, gateway.listing);
        if (request.method === 'GET' && path === '/v1/credits') {
          return json(response, 200, gateway.credits);
        }
        if (request.method === 'POST' && path === '/v1/chat/completions') {
          const text = Buffer.concat(chunks).toString('utf8');
          const index = gateway.chatBodies.length;
          gateway.chatBodies.push(text);
          gateway.chatAuth.push(request.headers.authorization);
          const behavior = gateway.behavior(index);
          if (behavior.kind === 'hang') return;
          if (behavior.kind === 'destroy') return request.socket.destroy();
          if (behavior.kind === 'status') {
            return json(response, behavior.status, { error: { message: 'server trouble' } });
          }
          const reply =
            gateway.source === undefined
              ? {
                  status: 200,
                  body: {
                    id: 'fake-1',
                    object: 'chat.completion',
                    choices: [
                      {
                        index: 0,
                        message: { role: 'assistant', content: 'ok' },
                        finish_reason: 'stop',
                      },
                    ],
                    usage: { prompt_tokens: 40, completion_tokens: 12 },
                  } as TJson,
                }
              : await gateway.source({
                  url: gateway.endpoint,
                  body: text,
                  signal: new AbortController().signal,
                });
          const base =
            reply.body !== null && typeof reply.body === 'object' && !Array.isArray(reply.body)
              ? (reply.body as { readonly [key: string]: TJson })
              : {};
          const usage =
            base.usage !== null && typeof base.usage === 'object' && !Array.isArray(base.usage)
              ? (base.usage as { readonly [key: string]: TJson })
              : {};
          return json(response, reply.status, {
            ...base,
            model: options.model,
            provider: options.provider,
            ...behavior.patch,
            usage: { ...usage, cost: options.costUsd ?? 0.0001, ...behavior.usage },
          });
        }
        return json(response, 404, { error: 'not found' });
      })();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  gateway.base = `http://127.0.0.1:${port}/v1`;
  gateway.endpoint = `${gateway.base}/chat/completions`;
  gateway.close = () =>
    new Promise<void>((resolve) => {
      server.closeAllConnections();
      server.close(() => resolve());
    });
  return gateway;
}
