/**
 * A channel adapter written only against the channel contract: it imports the contract's types and
 * nothing else of the product. A platform is stood in for by two loopback HTTP servers. Inbound
 * messages and button presses arrive as signed POSTs and become `onMessage` and `onApprovalAnswer`;
 * outbound text and approval requests are POSTed to the stand-in platform, an approval as structured
 * actions rather than text.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';

import type { AddressInfo } from 'node:net';
import type { IncomingMessage, Server } from 'node:http';

import type {
  IChannelAdapter,
  IChannelApprovalRequest,
  IChannelCapabilities,
  IChannelHandler,
} from '../index.js';

export interface ILoopbackChannel extends IChannelAdapter {
  /** The platform delivers a message: a signed POST to the adapter's inbound address. */
  deliver(conversationId: string, senderId: string, text: string): Promise<void>;
  /** The platform reports an action pressed: a signed POST to the adapter's inbound address. */
  press(approvalId: string, approve: boolean, senderId: string): Promise<void>;
  /** A POST as an attacker would send it: anything but the right signature. */
  deliverWithSignature(signature: string, body: string): Promise<number>;
  readonly sent: readonly { readonly conversationId: string; readonly text: string }[];
  readonly approvalRequests: readonly IChannelApprovalRequest[];
  /** What the platform received for each approval: the actions it can render as buttons. */
  readonly approvalActions: readonly (readonly { readonly id: string }[])[];
  /** Stop the adapter and the stand-in platform. */
  close(): Promise<void>;
}

const SECRET = 'loopback-shared-secret';
const sign = (body: string): string => createHmac('sha256', SECRET).update(body).digest('hex');

function listen(server: Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve((server.address() as AddressInfo).port));
  });
}

const closeServer = (server: Server): Promise<void> =>
  new Promise((resolve) => {
    server.closeAllConnections();
    server.close(() => resolve());
  });

function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    request.on('error', reject);
  });
}

function validSignature(given: string | undefined, body: string): boolean {
  if (given === undefined) return false;
  const expected = Buffer.from(sign(body));
  const actual = Buffer.from(given);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

async function post(port: number, path: string, body: string, signature?: string) {
  const response = await fetch(`http://127.0.0.1:${port}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(signature !== undefined && { 'x-signature': signature }),
    },
    body,
  });
  return response;
}

export async function createLoopbackChannel(
  options: { readonly id?: string; readonly capabilities?: Partial<IChannelCapabilities> } = {},
): Promise<ILoopbackChannel> {
  const capabilities: IChannelCapabilities = {
    actions: true,
    attachments: false,
    voice: false,
    ...options.capabilities,
  };
  const sent: { conversationId: string; text: string }[] = [];
  const approvalRequests: IChannelApprovalRequest[] = [];
  const approvalActions: { id: string }[][] = [];

  // The stand-in platform: it receives what the adapter sends out.
  const platform = createServer((request, response) => {
    void readBody(request).then((raw) => {
      const body = JSON.parse(raw) as Record<string, unknown>;
      if (request.url === '/send') {
        sent.push({
          conversationId: String(body['conversationId']),
          text: String(body['text']),
        });
      } else if (request.url === '/approval') {
        approvalRequests.push({
          conversationId: String(body['conversationId']),
          approvalId: String(body['approvalId']),
          title: String(body['title']),
          detail: String(body['detail']),
        });
        approvalActions.push(body['actions'] as { id: string }[]);
      }
      response.writeHead(204).end();
    });
  });
  const platformPort = await listen(platform);

  let handler: IChannelHandler | undefined;
  let inbound: Server | undefined;
  let inboundPort = 0;

  const deliverRaw = async (path: string, body: string, signature: string): Promise<number> => {
    if (inbound === undefined) throw new Error('The channel is not started');
    return (await post(inboundPort, path, body, signature)).status;
  };
  const deliverSigned = async (path: string, payload: unknown): Promise<void> => {
    const body = JSON.stringify(payload);
    const status = await deliverRaw(path, body, sign(body));
    if (status !== 204) throw new Error(`The adapter answered ${status}`);
  };

  const adapter: ILoopbackChannel = {
    id: options.id ?? 'loopback',
    capabilities,
    sent,
    approvalRequests,
    approvalActions,
    start: async (next) => {
      handler = next;
      inbound = createServer((request, response) => {
        void readBody(request).then(async (raw) => {
          if (!validSignature(request.headers['x-signature'] as string | undefined, raw)) {
            response.writeHead(401).end();
            return;
          }
          const body = JSON.parse(raw) as Record<string, string | boolean>;
          if (request.url === '/message') {
            await handler?.onMessage({
              conversationId: String(body['conversationId']),
              senderId: String(body['senderId']),
              text: String(body['text']),
            });
          } else if (request.url === '/action') {
            await handler?.onApprovalAnswer({
              approvalId: String(body['approvalId']),
              approve: body['action'] === 'approve',
              senderId: String(body['senderId']),
            });
          }
          response.writeHead(204).end();
        });
      });
      inboundPort = await listen(inbound);
    },
    stop: async () => {
      handler = undefined;
      const server = inbound;
      inbound = undefined;
      if (server !== undefined) await closeServer(server);
    },
    send: async (conversationId, text) => {
      await post(platformPort, '/send', JSON.stringify({ conversationId, text }));
    },
    deliver: (conversationId, senderId, text) =>
      deliverSigned('/message', { conversationId, senderId, text }),
    press: (approvalId, approve, senderId) =>
      deliverSigned('/action', { approvalId, senderId, action: approve ? 'approve' : 'decline' }),
    deliverWithSignature: (signature, body) => deliverRaw('/message', body, signature),
    close: async () => {
      await adapter.stop();
      await closeServer(platform);
    },
  };
  if (capabilities.actions) {
    return {
      ...adapter,
      requestApproval: async (request) => {
        await post(
          platformPort,
          '/approval',
          JSON.stringify({
            ...request,
            actions: [
              { id: 'approve', label: 'Approve' },
              { id: 'decline', label: 'Decline' },
            ],
          }),
        );
      },
    };
  }
  return adapter;
}
