/**
 * A stand-in for the service behind a notification address, written for the tests: a real HTTP server
 * on loopback that records every request it gets and answers as told. The protocol insists on `https`
 * addresses, so an in-process test reaches it through `virtualHostFetch`, as it does the connectors'
 * stand-ins; the code under test only ever sees an `https` address.
 */
import { createServer } from 'node:http';

import type { IncomingHttpHeaders } from 'node:http';
import type { AddressInfo } from 'node:net';

export interface IReceivedNotification {
  readonly method: string;
  readonly path: string;
  readonly headers: IncomingHttpHeaders;
  readonly body: string;
}

export interface IStandInWebhook {
  readonly port: number;
  /** Every request it received, in order. */
  readonly received: IReceivedNotification[];
  /** Answer the following requests with this status (and headers, and body), until told otherwise. */
  answer(status: number, headers?: Record<string, string>, body?: string): void;
  /** Take the following requests and never answer them, as a service that is down does. */
  hang(): void;
  close(): Promise<void>;
}

export async function startStandInWebhook(): Promise<IStandInWebhook> {
  const received: IReceivedNotification[] = [];
  let behaviour: { status: number; headers: Record<string, string>; body: string } | 'hang' = {
    status: 200,
    headers: {},
    body: 'ok',
  };
  const server = createServer((req, res) => {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (chunk: string) => (body += chunk));
    req.on('end', () => {
      received.push({ method: req.method ?? '', path: req.url ?? '', headers: req.headers, body });
      if (behaviour === 'hang') return;
      res.writeHead(behaviour.status, { 'content-type': 'text/plain', ...behaviour.headers });
      res.end(behaviour.body);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  return {
    port: (server.address() as AddressInfo).port,
    received,
    answer: (status, headers = {}, body = 'ok') => {
      behaviour = { status, headers, body };
    },
    hang: () => {
      behaviour = 'hang';
    },
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      }),
  };
}
