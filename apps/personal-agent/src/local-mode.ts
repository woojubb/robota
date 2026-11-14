/**
 * The personal agent's local mode: one session on this machine, reached by the web GUI over a
 * loopback WebSocket and by scripts over a loopback HTTP API, both admitted by credentials minted
 * for this launch.
 */
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:http';

import { getRequestListener } from '@hono/node-server';
import {
  TransportRegistry,
  bindTransportAdapter,
  createMemoryTransportSettingsRepository,
} from '@robota-sdk/agent-framework';
import { createHttpTransport } from '@robota-sdk/agent-transport/http';
import { WsTransport } from '@robota-sdk/agent-transport/ws';

import { createPersonalAgent } from './agent.js';
import { resolveGuiRoot, startGuiServer } from './gui-server.js';

import type { IAIProvider, IToolWithEventService, TPermissionMode } from '@robota-sdk/agent-core';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { IPersonalAgent } from './agent.js';
import type { IGuiServer } from './gui-server.js';

const LOOPBACK = '127.0.0.1';

export interface ILocalModeOptions {
  readonly stateDir: string;
  readonly provider: IAIProvider;
  readonly model?: string;
  readonly tools?: readonly IToolWithEventService[];
  readonly instructions?: string;
  readonly permissionMode?: TPermissionMode;
  /** Serve the web GUI (default true). */
  readonly gui?: boolean;
  /** The built GUI to serve; defaults to the one `@robota-sdk/agent-gui-web` ships. */
  readonly webRoot?: string;
  /** WebSocket port; omitted lets the system choose a free one. */
  readonly wsPort?: number;
}

export interface ILocalMode {
  readonly agent: IPersonalAgent;
  readonly wsUrl: string;
  readonly httpUrl: string;
  /** The bearer every HTTP API request presents. */
  readonly httpToken: string;
  readonly gui?: IGuiServer;
  stop(): Promise<void>;
}

/**
 * A free loopback port, chosen by the system. The WebSocket transport reports the port it was asked
 * for rather than the one it bound, so it is handed a concrete free port instead of 0.
 */
async function findFreeLoopbackPort(): Promise<number> {
  const probe = createServer();
  await new Promise<void>((resolve, reject) => {
    probe.once('error', reject);
    probe.listen(0, LOOPBACK, () => resolve());
  });
  const port = (probe.address() as AddressInfo).port;
  await new Promise<void>((resolve) => probe.close(() => resolve()));
  return port;
}

export async function startLocalMode(options: ILocalModeOptions): Promise<ILocalMode> {
  const agent = createPersonalAgent({
    stateDir: options.stateDir,
    provider: options.provider,
    ...(options.model !== undefined && { model: options.model }),
    ...(options.tools !== undefined && { tools: options.tools }),
    ...(options.instructions !== undefined && { instructions: options.instructions }),
    ...(options.permissionMode !== undefined && { permissionMode: options.permissionMode }),
  });

  const ws = new WsTransport({
    port: options.wsPort ?? (await findFreeLoopbackPort()),
    maxRetries: 0,
    driverId: 'local:web',
    surface: 'browser',
  });
  const registry = new TransportRegistry(createMemoryTransportSettingsRepository());
  registry.register(bindTransportAdapter(ws, agent.session));
  await registry.startAll();
  const wsToken = ws.resolvedToken;
  if (wsToken === undefined || ws.boundPort === undefined) throw new Error('The WebSocket transport did not start');
  const wsUrl = `ws://${LOOPBACK}:${ws.boundPort}/?token=${encodeURIComponent(wsToken)}`;

  const httpToken = randomBytes(32).toString('base64url');
  const http = createHttpTransport({ admission: { token: httpToken } });
  http.attach(agent.session);
  await http.start();
  const httpServer: Server = createServer(getRequestListener(http.getApp().fetch));
  await new Promise<void>((resolve, reject) => {
    httpServer.once('error', reject);
    httpServer.listen(0, LOOPBACK, () => resolve());
  });
  const httpUrl = `http://${LOOPBACK}:${(httpServer.address() as AddressInfo).port}`;

  let gui: IGuiServer | undefined;
  if (options.gui !== false) {
    const webRoot = options.webRoot ?? resolveGuiRoot();
    if (webRoot === undefined) throw new Error('The web GUI is not built: run `pnpm --filter @robota-sdk/agent-gui-web build`');
    gui = await startGuiServer({ webRoot, wsUrl });
  }

  let stopped = false;
  return {
    agent,
    wsUrl,
    httpUrl,
    httpToken,
    ...(gui !== undefined && { gui }),
    async stop() {
      if (stopped) return;
      stopped = true;
      await gui?.close();
      await new Promise<void>((resolve) => httpServer.close(() => resolve()));
      await http.stop().catch(() => undefined);
      await registry.stopAll();
      await agent.session.shutdown();
    },
  };
}
