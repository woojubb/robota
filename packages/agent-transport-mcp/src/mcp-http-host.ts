/**
 * Streamable HTTP carriers for one process-owned MCP session: an authenticated loopback host
 * admitted by a minted bearer, and a remote host admitted by OAuth access tokens. Both share one
 * listener lifecycle and one stateless MCP handler; they differ only in the gate in front of it.
 */
import { createServer } from 'node:http';
import { isIP } from 'node:net';

import { toNodeHandler } from '@modelcontextprotocol/node';
import { createMcpHandler, Server } from '@modelcontextprotocol/server';
import {
  bearerCredential,
  credentialMatches,
  mintTransportToken,
} from '@robota-sdk/agent-transport/node';

import { createMcpRemoteGate } from './mcp-remote-authorization.js';
import { invokeMcpTool, readCatalog, resolveSubmitTool } from './mcp-tool-surface.js';

import type { IMcpRemoteAuthorization } from './mcp-remote-authorization.js';
import type { IMcpTransportSession } from './mcp-session.js';
import type { IMcpSubmitToolIdentity } from './mcp-tool-surface.js';
import type { Tool as ModernTool } from '@modelcontextprotocol/server';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

const LOOPBACK = '127.0.0.1';
const MAX_BODY_BYTES = 1024 * 1024;
const MAX_ACTIVE_REQUESTS = 16;
const MAX_CONNECTIONS = 32;
const HEADERS_TIMEOUT_MS = 5000;
const REQUEST_TIMEOUT_MS = 15000;
const CLOSE_TIMEOUT_MS = 5000;

export interface IMcpHttpHostOptions {
  name: string;
  version: string;
  session: IMcpTransportSession;
  /** Defaults to an OS-assigned port. */
  port?: number;
  /** Accepted only for numeric IPv4 loopback; provided for explicit bind-refusal checks. */
  host?: string;
  /** Host-owned identity for the submission extension. */
  submitTool?: IMcpSubmitToolIdentity;
}

export interface IMcpHttpHost {
  start(): Promise<{ url: string; token: string }>;
  stop(): Promise<void>;
  waitForClose(): Promise<void>;
}

export interface IMcpRemoteHttpHostOptions {
  name: string;
  version: string;
  session: IMcpTransportSession;
  /** Defaults to an OS-assigned port. */
  port?: number;
  /** Literal IP address to bind. Defaults to `127.0.0.1`, for a proxy on the same machine. */
  host?: string;
  /** Who may reach the session, decided from OAuth access tokens. Required: there is no open mode. */
  authorization: IMcpRemoteAuthorization;
  /** Host-owned identity for the submission extension. */
  submitTool?: IMcpSubmitToolIdentity;
}

export interface IMcpRemoteHttpHost {
  /** Resolves with the address actually bound and the public URL clients are told to use. */
  start(): Promise<{ listening: string; url: string }>;
  stop(): Promise<void>;
  waitForClose(): Promise<void>;
}

/** Decides one request before its body is read. False means the response has been written. */
type TRequestGate = (
  req: IncomingMessage,
  res: ServerResponse,
  port: number,
) => boolean | Promise<boolean>;

interface IHostCore {
  start(): Promise<AddressInfo>;
  stop(): Promise<void>;
  waitForClose(): Promise<void>;
}

function validatePort(port: number | undefined): void {
  if (port !== undefined && (!Number.isInteger(port) || port < 0 || port > 65535)) {
    throw new Error('MCP HTTP port must be an integer in 0..65535');
  }
}

function createHostCore(
  options: Omit<IMcpHttpHostOptions, 'host'>,
  bindHost: string,
  gate: TRequestGate,
): IHostCore {
  const submitTool = resolveSubmitTool(options.submitTool);
  let listener: ReturnType<typeof createServer> | undefined;
  let handler: ReturnType<typeof createMcpHandler> | undefined;
  let stopPromise: Promise<void> | undefined;
  let startCalled = false;
  let stoppingRequested = false;
  let active = 0;
  let resolveClose: (() => void) | undefined;
  let rejectClose: ((error: Error) => void) | undefined;
  const closed = new Promise<void>((resolve, reject) => {
    resolveClose = resolve;
    rejectClose = reject;
  });
  void closed.catch(() => undefined);

  return {
    async start() {
      if (startCalled || stopPromise) throw new Error('MCP HTTP host already started');
      startCalled = true;
      await readCatalog(options.session, submitTool.name);
      if (stoppingRequested) throw new Error('MCP HTTP host stopped during startup');
      handler = createMcpHandler(
        () => {
          const server = new Server(
            { name: options.name, version: options.version },
            { capabilities: { tools: {} } },
          );
          server.setRequestHandler('tools/list', async () => ({
            // The v1 catalog validator returns a wider schema type than SDK v2's JSON-only Tool.
            // Normalize at this SDK boundary while keeping one canonical runtime catalog owner.
            tools: JSON.parse(
              JSON.stringify([
                ...(await readCatalog(options.session, submitTool.name)),
                submitTool,
              ]),
            ) as ModernTool[],
          }));
          server.setRequestHandler('tools/call', async (request, ctx) =>
            invokeMcpTool(
              options.session,
              request.params.name,
              request.params.arguments ?? {},
              ctx.mcpReq.signal,
              submitTool.name,
            ),
          );
          return server;
        },
        { maxSubscriptions: 0 },
      );
      const nodeHandler = toNodeHandler(handler);
      const serve = (req: IncomingMessage, res: ServerResponse): void => {
        if (active >= MAX_ACTIVE_REQUESTS) {
          res.writeHead(503).end();
          return;
        }
        active += 1;
        void (async () => {
          try {
            let parsedBody: unknown;
            if (req.method === 'POST') {
              const declared = Number(req.headers['content-length']);
              if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
                res.writeHead(413).end();
                return;
              }
              const chunks: Buffer[] = [];
              let size = 0;
              for await (const chunk of req) {
                const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
                size += bytes.length;
                if (size > MAX_BODY_BYTES) {
                  res.writeHead(413).end();
                  req.destroy();
                  return;
                }
                chunks.push(bytes);
              }
              try {
                parsedBody = JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
              } catch {
                res.writeHead(400).end();
                return;
              }
            }
            await nodeHandler(req, res, parsedBody);
          } catch {
            if (!res.headersSent) res.writeHead(500).end();
            else res.destroy();
          } finally {
            active -= 1;
          }
        })();
      };
      const server = createServer({ maxHeaderSize: 16 * 1024 }, (req, res) => {
        const address = server.address();
        if (!address || typeof address === 'string') {
          res.writeHead(503).end();
          return;
        }
        const verdict = gate(req, res, address.port);
        if (verdict === true) {
          serve(req, res);
        } else if (verdict !== false) {
          verdict.then(
            (admitted) => {
              if (admitted) serve(req, res);
            },
            () => {
              if (!res.headersSent) res.writeHead(500).end();
              else res.destroy();
            },
          );
        }
      });
      server.maxConnections = MAX_CONNECTIONS;
      server.headersTimeout = HEADERS_TIMEOUT_MS;
      server.requestTimeout = REQUEST_TIMEOUT_MS;
      server.on('error', (error) => rejectClose?.(error));
      server.on('close', () => resolveClose?.());
      try {
        await new Promise<void>((resolve, reject) => {
          server.once('error', reject);
          server.listen(options.port ?? 0, bindHost, () => {
            server.off('error', reject);
            resolve();
          });
        });
      } catch (error) {
        await handler.close();
        throw error;
      }
      if (stoppingRequested) {
        await new Promise<void>((resolve) => server.close(() => resolve()));
        await handler.close();
        throw new Error('MCP HTTP host stopped during startup');
      }
      listener = server;
      return server.address() as AddressInfo;
    },
    stop() {
      if (stopPromise) return stopPromise;
      stoppingRequested = true;
      stopPromise = (async () => {
        const currentHandler = handler;
        const currentListener = listener;
        if (!currentListener) {
          await currentHandler?.close();
          resolveClose?.();
          return;
        }
        const close = new Promise<void>((resolve, reject) => {
          currentListener.close((error) => (error ? reject(error) : resolve()));
          currentListener.closeAllConnections();
        });
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          await Promise.race([
            Promise.all([currentHandler?.close(), close]).then(() => undefined),
            new Promise<never>((_resolve, reject) => {
              timer = setTimeout(
                () => reject(new Error('MCP HTTP close timed out')),
                CLOSE_TIMEOUT_MS,
              );
            }),
          ]);
        } finally {
          if (timer) clearTimeout(timer);
        }
      })();
      return stopPromise;
    },
    waitForClose() {
      return closed;
    },
  };
}

export function createMcpHttpHost(options: IMcpHttpHostOptions): IMcpHttpHost {
  if (options.host !== undefined && options.host !== LOOPBACK) {
    throw new Error('MCP HTTP host must bind numeric IPv4 loopback');
  }
  validatePort(options.port);

  const token = mintTransportToken();
  const core = createHostCore(options, LOOPBACK, (req, res, port) => {
    const expectedHost = `${LOOPBACK}:${port}`;
    const expectedOrigin = `http://${expectedHost}`;
    if (
      req.url !== '/mcp' ||
      req.headers.host !== expectedHost ||
      (req.headers.origin !== undefined && req.headers.origin !== expectedOrigin)
    ) {
      res.writeHead(403).end();
      return false;
    }
    const authorization = req.headers.authorization;
    if (
      typeof authorization !== 'string' ||
      !credentialMatches(token, bearerCredential(authorization))
    ) {
      res.writeHead(401).end();
      return false;
    }
    return true;
  });

  return {
    async start() {
      const address = await core.start();
      return { url: `http://${LOOPBACK}:${address.port}/mcp`, token };
    },
    stop: core.stop,
    waitForClose: core.waitForClose,
  };
}

/**
 * A host reachable beyond loopback. It never mints or accepts the loopback bearer: every request
 * is admitted by an OAuth access token checked against the injected verifier.
 */
export function createMcpRemoteHttpHost(options: IMcpRemoteHttpHostOptions): IMcpRemoteHttpHost {
  const bindHost = options.host ?? LOOPBACK;
  if (isIP(bindHost) === 0) throw new Error('MCP HTTP host must bind a literal IP address');
  validatePort(options.port);
  const gate = createMcpRemoteGate(options.authorization);
  const core = createHostCore(options, bindHost, (req, res) => gate.admit(req, res));

  return {
    async start() {
      const address = await core.start();
      const host = address.family === 'IPv6' ? `[${address.address}]` : address.address;
      return { listening: `${host}:${address.port}`, url: options.authorization.publicUrl };
    },
    stop: core.stop,
    waitForClose: core.waitForClose,
  };
}
