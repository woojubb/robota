/**
 * A stand-in for a browser's push service, written for the tests: a real HTTP server on loopback that
 * records every request it gets, body bytes included, and answers as told, per path. The protocol insists
 * on `https` addresses, so an in-process test reaches it through `virtualHostFetch`, as it does the other
 * stand-ins; the code under test only ever sees an `https` address.
 */
import { createServer } from 'node:http';

import type { IncomingHttpHeaders } from 'node:http';
import type { AddressInfo } from 'node:net';

export interface IReceivedPush {
  readonly method: string;
  readonly path: string;
  readonly headers: IncomingHttpHeaders;
  readonly body: Buffer;
}

export interface IStandInPushService {
  readonly port: number;
  /** Every request it received, in order. */
  readonly received: IReceivedPush[];
  /** Answer the following requests (to `path`, or to any path not named) with this status and headers. */
  answer(status: number, options?: { path?: string; headers?: Record<string, string> }): void;
  /** Take the following requests (to `path`, or to any) and never answer them. */
  hang(path?: string): void;
  close(): Promise<void>;
}

type TBehaviour = { status: number; headers: Record<string, string> } | 'hang';

export async function startStandInPushService(): Promise<IStandInPushService> {
  const received: IReceivedPush[] = [];
  let fallback: TBehaviour = { status: 201, headers: {} };
  const byPath = new Map<string, TBehaviour>();
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      const path = req.url ?? '';
      received.push({
        method: req.method ?? '',
        path,
        headers: req.headers,
        body: Buffer.concat(chunks),
      });
      const behaviour = byPath.get(path) ?? fallback;
      if (behaviour === 'hang') return;
      res.writeHead(behaviour.status, behaviour.headers);
      res.end();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  return {
    port: (server.address() as AddressInfo).port,
    received,
    answer: (status, { path, headers = {} } = {}) => {
      if (path === undefined) fallback = { status, headers };
      else byPath.set(path, { status, headers });
    },
    hang: (path) => {
      if (path === undefined) fallback = 'hang';
      else byPath.set(path, 'hang');
    },
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      }),
  };
}
