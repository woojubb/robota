/**
 * Request-scoped cancellation and trusted `traceparent` for MCP calls over Streamable HTTP.
 *
 * Both are decided from the request itself, never from an ambient context. The session hands the
 * SDK the headers one call may carry (`traceparent`, only for an exactly listed origin) as that
 * call's own per-request `headers`, so the SDK puts them on that call's `tools/call` POST and on no
 * other request — not a `tools/list` refresh a `list_changed` triggers, not a reply to a server
 * request, not a GET stream. The transport remembers them by JSON-RPC id so the
 * `notifications/cancelled` that cancels the call carries them too.
 *
 * Cancellation is by id as well. On a legacy connection the SDK cancels a call by sending
 * `notifications/cancelled` and leaves the call's POST (or SSE stream) open; the transport keeps an
 * abort controller per `tools/call`, hands it to the SDK as that request's `requestSignal`, and
 * aborts it when the matching notification goes out. On a 2026-era connection the SDK creates and
 * aborts that signal itself and the transport does not.
 */

import { traceHeadersFor } from '@robota-sdk/agent-core';

import type { IOutboundTraceContext } from '@robota-sdk/agent-core';

type TJsonRpcId = string | number;

/** The headers a call's cancellation repeats; only `traceparent` is ever carried. */
export type TMCPCallTraceHeaders = Readonly<Record<string, string>>;

interface IPendingCall {
  readonly controller: AbortController;
  readonly traceHeaders: TMCPCallTraceHeaders;
}

/**
 * The in-flight HTTP tool calls of one transport, by JSON-RPC id, so a cancellation — sent from
 * wherever the abort or timeout fired — finds the call it cancels. An entry ends with the call's
 * response, its stream, a failed send, its cancellation or the transport.
 */
export class MCPCallRequests {
  private readonly byRequestId = new Map<TJsonRpcId, IPendingCall>();

  get size(): number {
    return this.byRequestId.size;
  }

  /** Starts tracking a call and returns the signal that withdraws its request. */
  begin(requestId: TJsonRpcId, traceHeaders: TMCPCallTraceHeaders): AbortSignal {
    const controller = new AbortController();
    this.byRequestId.set(requestId, { controller, traceHeaders });
    return controller.signal;
  }

  /**
   * Withdraws the request of a call that is being cancelled and stops tracking it. Returns the
   * headers its cancellation repeats, or `undefined` for a call this transport does not track.
   */
  abort(requestId: TJsonRpcId): TMCPCallTraceHeaders | undefined {
    const call = this.byRequestId.get(requestId);
    if (call === undefined) return undefined;
    this.byRequestId.delete(requestId);
    call.controller.abort();
    return call.traceHeaders;
  }

  /** Stops tracking a call that ended without being cancelled. */
  release(requestId: TJsonRpcId): void {
    this.byRequestId.delete(requestId);
  }

  clear(): void {
    this.byRequestId.clear();
  }
}

const callRequests = new WeakMap<object, MCPCallRequests>();

/** Binds the call tracking to the transport that sends for it; one transport serves one session. */
export function bindCallRequests(transport: object, requests: MCPCallRequests): void {
  callRequests.set(transport, requests);
}

/** The call tracking of an HTTP transport; undefined for any other (stdio). */
export function callRequestsOf(transport: object): MCPCallRequests | undefined {
  return callRequests.get(transport);
}

const endpoints = new WeakMap<object, string>();

/** Records the admitted URL of an HTTP transport, the only origin a call's trace may be sent to. */
export function bindTraceEndpoint(transport: object, admittedUrl: string): void {
  endpoints.set(transport, admittedUrl);
}

/**
 * The headers one tool call may carry to this transport's endpoint: `traceparent` when the endpoint's
 * origin exactly equals a listed origin, an empty record when it does not, and `undefined` for a
 * transport that is not HTTP (stdio), which carries none.
 */
export function outboundTraceHeaders(
  transport: object,
  outbound: IOutboundTraceContext,
): TMCPCallTraceHeaders | undefined {
  const endpoint = endpoints.get(transport);
  return endpoint === undefined ? undefined : traceHeadersFor(endpoint, outbound);
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

/** The id a single JSON-RPC response (result or error) answers, or undefined for anything else. */
export function respondedRequestId(message: unknown): TJsonRpcId | undefined {
  if (!isRecord(message) || message['jsonrpc'] !== '2.0' || 'method' in message) return undefined;
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
