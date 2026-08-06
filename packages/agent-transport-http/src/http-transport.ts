/**
 * ITransportAdapter implementation for HTTP transport.
 *
 * Wraps createAgentRoutes into the unified ITransportAdapter interface
 * while exposing the underlying Hono app via getApp().
 */

import { createAgentRoutes } from './routes.js';

import { resolveAdmission } from '@robota-sdk/agent-interface-transport';
import type {
  IInteractiveSession,
  ITransportAdapter,
  ITransportAdmissionConfig,
} from '@robota-sdk/agent-interface-transport';
import type { Hono } from 'hono';

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
}

export function createHttpTransport(
  options?: IHttpTransportOptions,
): ITransportAdapter<IInteractiveSession> & {
  getApp(): Hono;
  getAdmissionToken(): string | null;
} {
  let session: IInteractiveSession | null = null;
  let app: Hono | null = null;
  // Resolved at CONSTRUCTION, not at start: a host needs the credential to hand to its client, and
  // a transport that cannot mint one must fail before anything is served.
  const admission = resolveAdmission(options?.admission);

  return {
    name: 'http',
    attach(s: IInteractiveSession) {
      session = s;
    },
    async start() {
      if (!session) throw new Error('No session attached. Call attach() first.');
      app = createAgentRoutes({
        sessionFactory: () => session!,
        admission:
          admission.token === null
            ? { open: true, openReason: admission.openReason ?? '' }
            : { token: admission.token },
      });
    },
    async stop() {
      app = null;
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
