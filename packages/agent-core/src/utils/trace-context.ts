/**
 * Pure helpers for trusted W3C trace context. Strings and the WHATWG `URL` only, so they are the
 * same in the browser build and in every adapter that attaches the header.
 */
import type { IOutboundTraceContext, IRunTraceContext } from '../interfaces/trace-context';

const TRACE_ID = /^(?!0{32}$)[0-9a-f]{32}$/;
const SPAN_ID = /^(?!0{16}$)[0-9a-f]{16}$/;

/**
 * The span ID an operation is exported under, derived from the ID core mints before it runs (a
 * provider call's call ID, a tool body's body ID). One derivation for both the exporter and the
 * outgoing header, so the span a recipient sees as its parent is the span the trace contains.
 */
export function spanIdFromMintedId(mintedId: string): string {
  return mintedId.replaceAll('-', '').slice(0, 16);
}

/** The provider-call name for {@link spanIdFromMintedId}, kept so existing callers keep working. */
export const providerCallSpanId: (callId: string) => string = spanIdFromMintedId;

/** A sampled version-00 `traceparent`, or undefined when either identifier is invalid. */
export function buildTraceparent(traceId: string, spanId: string): string | undefined {
  if (!TRACE_ID.test(traceId) || !SPAN_ID.test(spanId)) return undefined;
  return `00-${traceId}-${spanId}-01`;
}

/** The outbound context for one invoked call, or undefined when there is nothing valid to send. */
export function outboundTraceContextFor(
  traceContext: IRunTraceContext,
  callId: string,
): IOutboundTraceContext | undefined {
  if (traceContext.allowedOrigins.length === 0) return undefined;
  const traceparent = buildTraceparent(traceContext.traceId, spanIdFromMintedId(callId));
  if (traceparent === undefined) return undefined;
  return { traceparent, allowedOrigins: [...traceContext.allowedOrigins] };
}

/**
 * The outbound context for one tool body, keyed by the body ID core minted for it — never the
 * vendor's tool call ID, which is neither unique nor hex.
 */
export function toolTraceContextFor(
  traceContext: IRunTraceContext,
  toolBodyId: string,
): IOutboundTraceContext | undefined {
  return outboundTraceContextFor(traceContext, toolBodyId);
}

/**
 * The headers to add to a request whose effective base URL is `baseUrl`: `traceparent` when its
 * origin exactly equals a listed origin, nothing otherwise. Scheme, host and port must all match;
 * a subdomain or a different port is a different origin.
 */
export function traceHeadersFor(
  baseUrl: string | undefined,
  traceContext: IOutboundTraceContext | undefined,
): Readonly<Record<string, string>> {
  if (baseUrl === undefined || traceContext === undefined) return {};
  let origin: string;
  try {
    origin = new URL(baseUrl).origin;
  } catch {
    return {};
  }
  if (origin === 'null' || !traceContext.allowedOrigins.includes(origin)) return {};
  return { traceparent: traceContext.traceparent };
}
