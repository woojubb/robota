/**
 * ITransportAdapter implementation for HTTP transport.
 *
 * Wraps createAgentRoutes into the unified ITransportAdapter interface
 * while exposing the underlying Hono app via getApp().
 */

import { resolveAdmission } from '@robota-sdk/agent-transport-protocol';
import { Hono } from 'hono';

import { createAgentRoutes } from './routes.js';

import type { IHttpTransportSession } from './http-session.js';
import type { TStreamFailureListener } from './submit-stream.js';
import type { IInteractiveSession } from '@robota-sdk/agent-interface-session';
import type {
  ITransportAdapter,
  ITransportAdmissionConfig,
  ITransportLifecycleError,
} from '@robota-sdk/agent-interface-transport';

export interface IHttpTransportOptions {
  /** Optional: base path prefix for routes. */
  basePath?: string;
  /**
   * SEC-008: what a peer must present. Omitted means SECURE — a credential is minted and
   * `getAdmissionToken()` returns it for the host to hand to its client.
   *
   * This transport previously had no gate at all, so omitting the option used to mean "anyone may
   * execute anything". Omission now means the safe thing, and running open takes saying so.
   */
  admission?: ITransportAdmissionConfig;
  /**
   * Where the DETAIL of a post-headers stream failure goes — forwarded to `createAgentRoutes`.
   * Review found this seam missing: the option existed on the routes and not on the entry point
   * README and the examples actually use, so "the host decides the destination" was a decision no
   * host on this path could make. Same forwarding rule as `admission`, which sat beside it.
   */
  onStreamFailure?: TStreamFailureListener;
}

export interface IHttpTransport extends ITransportAdapter<IInteractiveSession> {
  attach(session: IHttpTransportSession): void;
  getApp(): Hono;
  getAdmissionToken(): string | null;
}

export function createHttpTransport(options?: IHttpTransportOptions): IHttpTransport {
  let session: IHttpTransportSession | null = null;
  let app: Hono | null = null;
  // Resolved at CONSTRUCTION, not at start: a host needs the credential to hand to its client, and
  // a transport that cannot mint one must fail before anything is served.
  const admission = resolveAdmission(options?.admission);
  const lifecycleError = (code: ITransportLifecycleError['code']): ITransportLifecycleError =>
    Object.assign(new Error(`HTTP transport ${code}.`), {
      name: 'TransportLifecycleError' as const,
      code,
      transportName: 'http',
    });

  return {
    name: 'http',
    lifecycle: Object.freeze({ kind: 'service' }),
    attach(s: IHttpTransportSession) {
      session = s;
    },
    async start() {
      if (!session) throw lifecycleError('not-attached');
      if (app) throw lifecycleError('already-started');
      const routes = createAgentRoutes({
        sessionFactory: () => session!,
        // The decision already made, passed through — not taken apart and rebuilt for the routes to
        // resolve a second time.
        admission,
        onStreamFailure: options?.onStreamFailure,
      });
      // TRANS-002 (issue #2480): `basePath` was declared and advertised but never read, so routes
      // always mounted at root. It is honored here — or absent, in which case the routes ARE the app.
      app = options?.basePath ? new Hono().route(options.basePath, routes) : routes;
    },
    async stop() {
      app = null;
      session = null;
    },
    getApp() {
      if (!app) throw new Error('Transport not started. Call start() first.');
      return app;
    },
    /** The credential this transport requires, or `null` when the host explicitly opened it. */
    getAdmissionToken() {
      return admission.token;
    },
  };
}
