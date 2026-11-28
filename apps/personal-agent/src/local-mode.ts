/**
 * The personal agent's local mode: the agent's chats on this machine, reached by the web GUI over a
 * loopback WebSocket and by scripts over a loopback HTTP API, both admitted by credentials minted
 * for this launch. The runtime keeps several chats live in a pool, and each page that connects has
 * its own place in it: it lists the saved chats, starts a new one or switches, without moving
 * anyone else. The HTTP API drives the chat the runtime started with.
 */
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:http';

import { getRequestListener } from '@hono/node-server';
import {
  SESSION_POOL_MAX_LIVE,
  SessionPool,
  TransportRegistry,
  bindTransportAdapter,
  buildRuntimeSession,
  createMemoryTransportSettingsRepository,
  createServeSessionDirectory,
  startRuntimeHost,
} from '@robota-sdk/agent-framework';
import { createHttpTransport } from '@robota-sdk/agent-transport/http';
import { WsTransport } from '@robota-sdk/agent-transport/ws';

import { createPersonalAgent } from './agent.js';
import { boundGuiPort, loadGuiPort, saveGuiPort } from './gui-port.js';
import { startLoopbackGuiServer } from '@robota-sdk/agent-local-host';

import { GUI_LABELS, guiHeadHtml, resolveGuiRoot } from './gui-server.js';
import { createOwedRedactions } from './owed-redactions.js';

import type { IHeldConversations, ILiveConversation } from './conversation-forgetting.js';

import type { IAIProvider, IToolWithEventService, TPermissionMode } from '@robota-sdk/agent-core';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { IPersonalAgent } from './agent.js';
import type {
  IRuntimeHostHandle,
  InteractiveSession,
  SessionSlot,
} from '@robota-sdk/agent-framework';
import type { ILoopbackGuiServer, ILoopbackGuiServerOptions } from '@robota-sdk/agent-local-host';

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
  /** The built web UI to serve; defaults to the one `@robota-sdk/personal-gui-web` builds. */
  readonly webRoot?: string;
  /** The personal API the web UI calls, served beside it behind the same access cookie. */
  readonly api?: ILoopbackGuiServerOptions['api'];
  /** The one path another site sends the person's browser back to, such as a sign-in's redirect. */
  readonly landing?: ILoopbackGuiServerOptions['landing'];
  /** WebSocket port; omitted lets the system choose a free one. */
  readonly wsPort?: number;
  /**
   * A fixed loopback port for the web UI, so an address registered in advance (a sign-in's redirect
   * with a service that requires one) stays valid across restarts; omitted reuses the last port.
   */
  readonly guiPort?: number;
  /**
   * Publish the web UI through a TLS reverse proxy on this host. Everything still listens on
   * loopback; the proxy forwards the public host to the GUI port, and `/ws/` to the WebSocket port.
   */
  readonly server?: IServerExposure;
}

export interface IServerExposure {
  /** Where people open the agent, such as `https://agent.example.com`. */
  readonly publicOrigin: string;
  readonly guiPort: number;
  readonly wsPort: number;
  /** The access code kept across restarts. */
  readonly accessCode: string;
}

/** The WebSocket address the page is given when the agent is published at `publicOrigin`. */
export function publicWsUrl(publicOrigin: string, token: string): string {
  const url = new URL(publicOrigin);
  const scheme = url.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${scheme}//${url.host}/ws/?token=${encodeURIComponent(token)}`;
}

export interface ILocalMode {
  readonly agent: IPersonalAgent;
  /** The chat the runtime started with: the one the HTTP API drives. */
  readonly primary: InteractiveSession;
  readonly wsUrl: string;
  readonly httpUrl: string;
  /** The bearer every HTTP API request presents. */
  readonly httpToken: string;
  readonly gui?: ILoopbackGuiServer;
  /** The sessions this process runs and what their saves owe a forget: what the library's forget reaches. */
  readonly conversations: IHeldConversations;
  stop(): Promise<void>;
}

export async function startLocalMode(options: ILocalModeOptions): Promise<ILocalMode> {
  const owed = createOwedRedactions();
  const agent = createPersonalAgent({
    stateDir: options.stateDir,
    owedRedactions: owed,
    provider: options.provider,
    ...(options.model !== undefined && { model: options.model }),
    ...(options.tools !== undefined && { tools: options.tools }),
    ...(options.instructions !== undefined && { instructions: options.instructions }),
    ...(options.permissionMode !== undefined && { permissionMode: options.permissionMode }),
  });

  const cleanups: (() => Promise<void>)[] = [];
  const unwind = async (): Promise<void> => {
    for (const step of cleanups.splice(0).reverse()) await step().catch(() => undefined);
  };
  let wsUrl: string;
  let httpUrl: string;
  const httpToken = randomBytes(32).toString('base64url');
  let gui: ILoopbackGuiServer | undefined;
  let pageHeadHtml: string | undefined;
  let pendingGuiPort: { port: number; replace: boolean } | undefined;
  let primary: InteractiveSession;
  let pool: SessionPool<InteractiveSession> | undefined;
  try {
    if (options.gui !== false) {
      const webRoot = options.webRoot ?? resolveGuiRoot();
      if (webRoot === undefined)
        throw new Error(
          'The web UI is not built: run `pnpm --filter @robota-sdk/personal-gui-web build`',
        );
      const remembered = options.server === undefined ? loadGuiPort(options.stateDir) : undefined;
      const port = options.server?.guiPort ?? options.guiPort ?? remembered ?? 0;
      let started: ILoopbackGuiServer;
      try {
        started = await startLoopbackGuiServer({
          webRoot,
          headHtml: () => pageHeadHtml,
          labels: GUI_LABELS,
          port,
          ...(options.server !== undefined && {
            publicOrigin: options.server.publicOrigin,
            accessCode: options.server.accessCode,
          }),
          ...(options.api !== undefined && { api: options.api }),
          ...(options.landing !== undefined && { landing: options.landing }),
        });
      } catch (error) {
        if (
          port !== 0 &&
          typeof error === 'object' &&
          error !== null &&
          'code' in error &&
          error.code === 'EADDRINUSE'
        ) {
          throw new Error(
            `GUI port ${port} is in use. Stop the other process or choose --gui-port.`,
            { cause: error },
          );
        }
        throw error;
      }
      gui = started;
      cleanups.push(() => started.close());
      if (options.server === undefined) {
        const actualPort = boundGuiPort(port, started.url);
        if (remembered !== actualPort) {
          pendingGuiPort = {
            port: actualPort,
            replace: remembered !== undefined && options.guiPort !== undefined,
          };
        }
      }
    }
    const store = agent.runtime.sessionStore;
    if (store === undefined) throw new Error('The personal agent keeps no session store');
    // Each connected page gets its own place in the pool: its chat list, new chats and switches.
    const directory = createServeSessionDirectory<
      InteractiveSession,
      SessionSlot<InteractiveSession>
    >();
    let stopping = false;
    const publicUrl =
      options.server === undefined ? undefined : new URL(options.server.publicOrigin);
    const ws = new WsTransport({
      // Port 0 lets the system pick a free port; the transport reports the one it bound.
      port: options.server?.wsPort ?? options.wsPort ?? 0,
      // Behind the proxy the upgrade carries the public host and, from a browser, its origin.
      ...(publicUrl !== undefined && {
        allowedHosts: [publicUrl.hostname.toLowerCase()],
        allowedOrigins: [publicUrl.origin],
      }),
      maxRetries: 0,
      driverId: 'local:web',
      surface: 'browser',
      sessionBinder: directory,
    });
    const registry = new TransportRegistry(createMemoryTransportSettingsRepository());
    const host: IRuntimeHostHandle = await startRuntimeHost({
      session: agent.chatRecipe(),
      transportRegistry: registry,
      bindTransports: (slot) => {
        const live = new SessionPool<InteractiveSession>({
          primary: slot.current,
          build: (resumeSessionId) =>
            buildRuntimeSession({
              ...agent.chatRecipe(),
              ...(resumeSessionId !== undefined && { resumeSessionId }),
            }),
          maxLive: SESSION_POOL_MAX_LIVE,
        });
        pool = live;
        // Registered as soon as there is something to release, so a start that fails after this
        // (a WebSocket port already taken, say) still stops the transports and closes the sessions.
        cleanups.push(async () => {
          stopping = true;
          await registry.stopAll();
          await live.shutdownAll('The personal agent is stopping');
        });
        directory.attach({
          pool: live,
          primary: slot.current,
          store,
          cwd: agent.workspace,
          isStopping: () => stopping,
        });
        registry.register(bindTransportAdapter(ws, slot));
      },
    });
    cleanups.push(async () => {
      stopping = true;
      await host.shutdown('The personal agent is stopping');
      await pool?.shutdownAll('The personal agent is stopping');
    });
    primary = host.session.current;
    const wsToken = ws.resolvedToken;
    if (wsToken === undefined || ws.boundPort === undefined)
      throw new Error('The WebSocket transport did not start');
    wsUrl = `ws://${LOOPBACK}:${ws.boundPort}/?token=${encodeURIComponent(wsToken)}`;
    // The page reaches the WebSocket the way people reach the page: through the proxy when published.
    const pageWsUrl =
      options.server === undefined ? wsUrl : publicWsUrl(options.server.publicOrigin, wsToken);

    const http = createHttpTransport({ admission: { token: httpToken } });
    http.attach(primary);
    await http.start();
    cleanups.push(() => http.stop().catch(() => undefined));
    const httpServer: Server = createServer(getRequestListener(http.getApp().fetch));
    await new Promise<void>((resolve, reject) => {
      httpServer.once('error', reject);
      httpServer.listen(0, LOOPBACK, () => resolve());
    });
    // An open SSE stream (a turn waiting on a prompt) must not hold shutdown, so connections are ended.
    cleanups.push(
      () =>
        new Promise<void>((resolve) => {
          httpServer.close(() => resolve());
          httpServer.closeAllConnections();
        }),
    );
    httpUrl = `http://${LOOPBACK}:${(httpServer.address() as AddressInfo).port}`;

    if (pendingGuiPort !== undefined) {
      const kept = saveGuiPort(options.stateDir, pendingGuiPort.port, pendingGuiPort.replace);
      if (kept !== pendingGuiPort.port)
        throw new Error('Another agent selected a GUI port; start again');
    }
    pageHeadHtml = guiHeadHtml(pageWsUrl);
  } catch (error) {
    await unwind();
    throw error;
  }

  let stopped = false;
  return {
    agent,
    primary,
    wsUrl,
    httpUrl,
    httpToken,
    ...(gui !== undefined && { gui }),
    conversations: {
      owed,
      live: () => {
        const sessions = new Set<ILiveConversation>(agent.liveSessions());
        for (const entry of pool?.listLive() ?? []) sessions.add(entry.session);
        return [...sessions];
      },
    },
    async stop() {
      if (stopped) return;
      stopped = true;
      await unwind();
    },
  };
}
