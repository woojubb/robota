/**
 * The agent HTTP API of `--serve`: the routes of `@robota-sdk/agent-transport-http` on a loopback
 * listener, so another application or service can submit work, stream the result over SSE, run a
 * command and abort without a Robota client library.
 *
 * Serve mode owns it the way it owns the external-event endpoint: started once the runtime host is
 * up, stopped before the host shuts down. Each request resolves the runtime's current primary
 * session, so a session the runtime replaces is followed without binding again. Admission and the
 * one-turn-per-session rule are the routes' own; this module adds only the listener.
 */

import { createServer, type Server } from 'node:http';

import { getRequestListener } from '@hono/node-server';
import { createAgentRoutes } from '@robota-sdk/agent-transport-http';

import type { IHttpTransportSession } from '@robota-sdk/agent-transport-http';

const LOOPBACK = '127.0.0.1';
/**
 * Who an HTTP turn is attributed to: assigned here, never taken from the request, so a client cannot
 * record its turns as the local operator's or another surface's.
 */
const HTTP_TURN_ATTRIBUTION = { driverId: 'remote:http', surface: 'remote' } as const;

export interface IServeHttpHostOptions {
  /** Loopback port; 0 picks one. */
  readonly port: number;
  /** The bearer every request presents. */
  readonly token: string;
  /** The session a request reaches, resolved per request. */
  readonly session: () => IHttpTransportSession;
  /** Where the detail of a stream that failed after its headers goes; the client gets a generic line. */
  readonly onStreamFailure?: (error: Error) => void;
}

export interface IServeHttpHost {
  /** `http://127.0.0.1:<port>` — never carries the bearer. */
  readonly url: string;
  stop(): Promise<void>;
}

export async function startServeHttpHost(options: IServeHttpHostOptions): Promise<IServeHttpHost> {
  const routes = createAgentRoutes({
    sessionFactory: options.session,
    admission: { token: options.token },
    attribution: HTTP_TURN_ATTRIBUTION,
    ...(options.onStreamFailure !== undefined ? { onStreamFailure: options.onStreamFailure } : {}),
  });
  const server = createServer(getRequestListener(routes.fetch));
  await listen(server, options.port);
  const address = server.address();
  if (address === null || typeof address === 'string') {
    await close(server);
    throw new Error('HTTP API listener has no port.');
  }
  return {
    url: `http://${LOOPBACK}:${address.port}`,
    // An open SSE stream would hold `close()` until it ends, so live connections are cut first.
    stop: async () => {
      server.closeAllConnections();
      await close(server);
    },
  };
}

function listen(server: Server, port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const onError = (error: Error): void => reject(error);
    server.once('error', onError);
    server.listen(port, LOOPBACK, () => {
      server.off('error', onError);
      resolve();
    });
  });
}

function close(server: Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}
