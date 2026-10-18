/**
 * The host side of the MCP Apps dialect (JSON-RPC 2.0 over `postMessage`, protocol 2026-01-26) for
 * one app view shown in a frame. Pure: no React, no window of its own. The caller hands it the
 * frame's window and a way to post to it, and feeds it every `message` event the page receives.
 *
 * The view is untrusted. A message counts only when it comes from the frame's own window and is a
 * plain JSON-RPC object; nothing the view sends is evaluated, and it reaches exactly three things:
 * the answers below, a bounded frame height, and the tools its own server declared (one call at a
 * time, each still passing the session's permission gate on the other side of `callAppTool`).
 */

import { outcomeToCallToolResult, type ICallToolResult } from './call-tool-result.js';

import type { TAppToolArguments, TAppToolOutcome, TAppView } from './types.js';

export const APP_VIEW_PROTOCOL_VERSION = '2026-01-26';
export const APP_VIEW_MIN_HEIGHT_PX = 48;
export const APP_VIEW_MAX_HEIGHT_PX = 640;

/** JSON-RPC error codes this host answers with. */
const INVALID_PARAMS = -32602;
const METHOD_NOT_FOUND = -32601;
const HOST_ERROR = -32000;

const SANDBOX_PROXY_READY = 'ui/notifications/sandbox-proxy-ready';
const SANDBOX_RESOURCE_READY = 'ui/notifications/sandbox-resource-ready';

type TJsonRpcId = string | number;

/** One JSON-RPC 2.0 message in either direction; which fields are present says what it is. */
export interface IAppViewMessage {
  jsonrpc: '2.0';
  id?: TJsonRpcId;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { code: number; message: string };
}

/** What the view is told about the place it is shown in (`McpUiInitializeResult.hostContext`). */
export interface IAppViewHostContext {
  theme: 'light' | 'dark';
  displayMode: 'inline';
  availableDisplayModes: readonly ['inline'];
  containerDimensions: { maxHeight: number };
  platform: 'desktop' | 'web';
  locale: string;
  timeZone: string;
}

export interface IAppViewBridgeOptions {
  view: TAppView;
  /** What the finished call returned, handed to the view once it has initialized. */
  toolResult: ICallToolResult;
  hostInfo: { name: string; version: string };
  hostContext: IAppViewHostContext;
  /** Posts one message to the frame. */
  post: (message: IAppViewMessage) => void;
  /** The frame's window right now, or null once it is gone; the only source a message may have. */
  source: () => MessageEventSource | null;
  /** Runs one runtime tool for the view and settles with its outcome, or rejects when refused. */
  callAppTool: (runtimeName: string, args: TAppToolArguments) => Promise<TAppToolOutcome>;
  /** The frame's requested height in pixels, already bounded. */
  onHeight: (px: number) => void;
}

export interface IAppViewBridge {
  handleMessage: (event: MessageEvent) => void;
  dispose: () => void;
}

/** A structured-cloned JSON object: not an array, not a class instance, whichever realm made it. */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === null || Object.getPrototypeOf(prototype) === null;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function createAppViewBridge(options: IAppViewBridgeOptions): IAppViewBridge {
  const { view } = options;
  let disposed = false;
  let sandboxAnswered = false;
  let initialized = false;
  let callInFlight = false;

  const respond = (id: TJsonRpcId, result: unknown): void => {
    options.post({ jsonrpc: '2.0', id, result });
  };
  const refuse = (id: TJsonRpcId, code: number, message: string): void => {
    options.post({ jsonrpc: '2.0', id, error: { code, message } });
  };

  const callTool = (id: TJsonRpcId, params: unknown): void => {
    const name = isPlainObject(params) ? params['name'] : undefined;
    const runtimeName =
      typeof name === 'string' && Object.hasOwn(view.callableTools, name)
        ? view.callableTools[name]
        : undefined;
    if (!isPlainObject(params) || runtimeName === undefined) {
      refuse(id, INVALID_PARAMS, 'This tool is not available to this view.');
      return;
    }
    const rawArguments = params['arguments'] === undefined ? {} : params['arguments'];
    if (!isPlainObject(rawArguments)) {
      refuse(id, INVALID_PARAMS, 'Tool arguments must be an object.');
      return;
    }
    if (callInFlight) {
      refuse(id, HOST_ERROR, 'Another tool call from this view is still running.');
      return;
    }
    callInFlight = true;
    let outcome: Promise<TAppToolOutcome>;
    try {
      outcome = options.callAppTool(runtimeName, rawArguments as TAppToolArguments);
    } catch (error: unknown) {
      outcome = Promise.reject(error);
    }
    outcome.then(
      (settled) => {
        callInFlight = false;
        if (!disposed) respond(id, outcomeToCallToolResult(settled));
      },
      (error: unknown) => {
        callInFlight = false;
        if (!disposed) refuse(id, HOST_ERROR, errorMessage(error));
      },
    );
  };

  const handleRequest = (id: TJsonRpcId, method: string, params: unknown): void => {
    switch (method) {
      case 'ui/initialize':
        respond(id, {
          protocolVersion: APP_VIEW_PROTOCOL_VERSION,
          hostCapabilities: { serverTools: {} },
          hostInfo: options.hostInfo,
          hostContext: options.hostContext,
        });
        return;
      case 'tools/call':
        callTool(id, params);
        return;
      case 'ping':
        respond(id, {});
        return;
      case 'ui/request-display-mode':
        respond(id, { mode: 'inline' });
        return;
      default:
        refuse(id, METHOD_NOT_FOUND, `This host does not support ${method}.`);
    }
  };

  const handleNotification = (method: string, params: unknown): void => {
    switch (method) {
      case SANDBOX_PROXY_READY:
        // The sandbox page is the only sender; the document goes to it once, never again.
        if (sandboxAnswered) return;
        sandboxAnswered = true;
        options.post({
          jsonrpc: '2.0',
          method: SANDBOX_RESOURCE_READY,
          params: { html: view.html },
        });
        return;
      case 'ui/notifications/initialized':
        if (initialized) return;
        initialized = true;
        options.post({
          jsonrpc: '2.0',
          method: 'ui/notifications/tool-input',
          params: { arguments: view.toolInput ?? {} },
        });
        options.post({
          jsonrpc: '2.0',
          method: 'ui/notifications/tool-result',
          params: options.toolResult,
        });
        return;
      case 'ui/notifications/size-changed': {
        const height = isPlainObject(params) ? params['height'] : undefined;
        if (typeof height !== 'number' || !Number.isFinite(height)) return;
        options.onHeight(
          Math.min(APP_VIEW_MAX_HEIGHT_PX, Math.max(APP_VIEW_MIN_HEIGHT_PX, Math.round(height))),
        );
        return;
      }
      default:
        // Anything else a view announces (logging, its own notices) has no consumer here.
        return;
    }
  };

  return {
    handleMessage(event) {
      if (disposed) return;
      const frame = options.source();
      if (frame === null || event.source !== frame) return;
      const data: unknown = event.data;
      if (!isPlainObject(data) || data['jsonrpc'] !== '2.0') return;
      const { method, id } = data;
      if (typeof method !== 'string') return;
      if (id === undefined) {
        handleNotification(method, data['params']);
      } else if (typeof id === 'string' || typeof id === 'number') {
        handleRequest(id, method, data['params']);
      }
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      if (initialized) {
        options.post({
          jsonrpc: '2.0',
          id: 'teardown',
          method: 'ui/resource-teardown',
          params: { reason: 'closed' },
        });
      }
    },
  };
}
