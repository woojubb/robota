/**
 * Trusted `traceparent` for MCP tool calls over Streamable HTTP.
 *
 * The async context only identifies WHICH tool call is running; it never decides that a header is
 * sent. The SDK's response stream keeps running inside the call's context, so a `tools/list`
 * refresh triggered by `list_changed`, a response to a server request, or a GET stream would all
 * inherit it. The header is therefore decided per request from the request body: only a POST whose
 * body is a single JSON-RPC `tools/call` recorded for this call, or the `notifications/cancelled`
 * that cancels it, carries it, and only to an exactly listed origin.
 */

import { AsyncLocalStorage } from 'node:async_hooks';

import { traceHeadersFor } from '@robota-sdk/agent-core';

import type { IOutboundTraceContext } from '@robota-sdk/agent-core';

type TJsonRpcId = string | number;

/** One tool call's trace: what it may send, and the JSON-RPC id its `tools/call` went out under. */
export interface IMCPCallTraceScope {
  readonly outbound: IOutboundTraceContext;
  requestId?: TJsonRpcId;
}

const activeCall = new AsyncLocalStorage<IMCPCallTraceScope>();

/** Runs one tool call with its trace scope as the async context. */
export function runInCallTraceScope<T>(scope: IMCPCallTraceScope, run: () => Promise<T>): Promise<T> {
  return activeCall.run(scope, run);
}

/** The running call's scope, if any. */
export function currentCallTraceScope(): IMCPCallTraceScope | undefined {
  return activeCall.getStore();
}

/**
 * The in-flight traced tool calls of one session, by JSON-RPC id, so a cancellation — sent from
 * wherever the abort or timeout fired — finds the call it cancels.
 */
export class MCPCallTraceRegistry {
  private readonly byRequestId = new Map<TJsonRpcId, IMCPCallTraceScope>();

  get size(): number {
    return this.byRequestId.size;
  }

  record(requestId: TJsonRpcId, scope: IMCPCallTraceScope): void {
    scope.requestId = requestId;
    this.byRequestId.set(requestId, scope);
  }

  lookup(requestId: TJsonRpcId): IMCPCallTraceScope | undefined {
    return this.byRequestId.get(requestId);
  }

  release(scope: IMCPCallTraceScope): void {
    const requestId = scope.requestId;
    if (requestId !== undefined && this.byRequestId.get(requestId) === scope) {
      this.byRequestId.delete(requestId);
    }
  }
}

const registries = new WeakMap<object, MCPCallTraceRegistry>();

/** Binds a registry to the transport that sends for it; one transport serves one session. */
export function bindCallTraceRegistry(transport: object, registry: MCPCallTraceRegistry): void {
  registries.set(transport, registry);
}

/** The registry of a transport that can carry trace context; undefined for any other (stdio). */
export function callTraceRegistryOf(transport: object): MCPCallTraceRegistry | undefined {
  return registries.get(transport);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isJsonRpcId(value: unknown): value is TJsonRpcId {
  return typeof value === 'string' || typeof value === 'number';
}

/** The id of a single JSON-RPC `tools/call` request, or undefined for anything else. */
export function toolsCallRequestId(message: unknown): TJsonRpcId | undefined {
  if (!isRecord(message) || message['jsonrpc'] !== '2.0' || message['method'] !== 'tools/call') {
    return undefined;
  }
  return isJsonRpcId(message['id']) ? message['id'] : undefined;
}

/** The request a single JSON-RPC `notifications/cancelled` cancels, or undefined for anything else. */
export function cancelledRequestId(message: unknown): TJsonRpcId | undefined {
  if (
    !isRecord(message) ||
    message['jsonrpc'] !== '2.0' ||
    message['method'] !== 'notifications/cancelled' ||
    'id' in message ||
    !isRecord(message['params'])
  ) {
    return undefined;
  }
  const requestId = message['params']['requestId'];
  return isJsonRpcId(requestId) ? requestId : undefined;
}

/**
 * The trace header for one outgoing HTTP request, decided from what the request is rather than from
 * the async context alone. Anything other than a POST whose string body is a single `tools/call`
 * recorded for the running call, or a `notifications/cancelled` for a recorded call, gets nothing.
 */
export function callTraceHeaders(
  init: RequestInit | undefined,
  admittedUrl: string,
  registry: MCPCallTraceRegistry,
): Readonly<Record<string, string>> {
  if (init?.method !== 'POST' || typeof init.body !== 'string') return {};
  let message: unknown;
  try {
    message = JSON.parse(init.body);
  } catch {
    return {};
  }
  const running = activeCall.getStore();
  const callId = toolsCallRequestId(message);
  if (callId !== undefined) {
    return running?.requestId === callId ? traceHeadersFor(admittedUrl, running.outbound) : {};
  }
  const cancelledId = cancelledRequestId(message);
  if (cancelledId === undefined) return {};
  const cancelled = running?.requestId === cancelledId ? running : registry.lookup(cancelledId);
  return cancelled ? traceHeadersFor(admittedUrl, cancelled.outbound) : {};
}
