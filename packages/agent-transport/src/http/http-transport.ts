/**
 * ITransportAdapter implementation for HTTP transport.
 *
 * Wraps createAgentRoutes into the unified ITransportAdapter interface
 * while exposing the underlying Hono app via getApp().
 */

import { resolveAdmission } from '../index';
import { Hono } from 'hono';

import { createAgentRoutes } from './routes.js';

import type { IHttpTransportSession } from './http-session.js';
import type { TStreamFailureListener, TTurnAttribution } from './submit-stream.js';
import type {
  ITransportAdapter,
  ITransportAdmissionConfig,
  ITransportLifecycleError,
} from '@robota-sdk/agent-interface/transport';

export interface IHttpTransportOptions {
  /** Optional: base path prefix for routes. */
  basePath?: string;
  /**
   * What a peer must present. Omitted means SECURE — a credential is minted and
   * `getAdmissionToken()` returns it for the host to hand to its client. Omission never means
   * "anyone may execute anything": running open takes saying so.
   */
  admission?: ITransportAdmissionConfig;
  /**
   * Where the DETAIL of a post-headers stream failure goes — forwarded to `createAgentRoutes`.
   * The option is on this entry point, which the README and the examples use, so the host that
   * builds the transport decides the destination, not only a host that mounts the routes itself.
   * Same forwarding rule as `admission`, which sits beside it.
   */
  onStreamFailure?: TStreamFailureListener;
  /** Who `/submit` turns are attributed to — forwarded to `createAgentRoutes`, like `admission`. */
  attribution?: TTurnAttribution;
}

export interface IHttpTransport extends ITransportAdapter<IHttpTransportSession> {
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
        attribution: options?.attribution,
      });
      // `basePath` was declared and advertised but never read, so routes
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
