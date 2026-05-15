/**
 * ITransportAdapter implementation for HTTP transport.
 *
 * Wraps createAgentRoutes into the unified ITransportAdapter interface
 * while exposing the underlying Hono app via getApp().
 */

import type { ITransportAdapter } from '@robota-sdk/agent-interface-transport';
import type { IInteractiveSession } from '@robota-sdk/agent-sdk';

import { createAgentRoutes } from './routes.js';
import type { Hono } from 'hono';

export interface IHttpTransportOptions {
  /** Optional: base path prefix for routes. */
  basePath?: string;
}

export function createHttpTransport(
  options?: IHttpTransportOptions,
): ITransportAdapter<IInteractiveSession> & { getApp(): Hono } {
  let session: IInteractiveSession | null = null;
  let app: Hono | null = null;

  return {
    name: 'http',
    attach(s: IInteractiveSession) {
      session = s;
    },
    async start() {
      if (!session) throw new Error('No session attached. Call attach() first.');
      app = createAgentRoutes({ sessionFactory: () => session! });
    },
    async stop() {
      app = null;
    },
    getApp() {
      if (!app) throw new Error('Transport not started. Call start() first.');
      return app;
    },
  };
}
