/**
 * Pure helpers for trusted W3C trace context. Strings and the WHATWG `URL` only, so they are the
 * same in the browser build and in every adapter that attaches the header.
 */
import type {
  IOutboundTraceContext,
  IRunTraceContext,
  ISubprocessTraceEnv,
  TSubprocessTraceClass,
} from '../interfaces/trace-context';

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

/** Whether `spanId` is a well-formed minted span ID: 16 lowercase hex characters, not all zero. */
export function isMintedSpanId(spanId: string): boolean {
  return SPAN_ID.test(spanId);
}

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
 * The environment one child process of `subprocessClass` receives, naming `spanId` as its parent,
 * or undefined when the host did not enable that class. Independent of the origin allowlist.
 */
export function traceEnvFor(
  subprocessClass: TSubprocessTraceClass,
  traceContext: IRunTraceContext | undefined,
  spanId: string,
): ISubprocessTraceEnv | undefined {
  if (traceContext?.subprocessClasses?.includes(subprocessClass) !== true) return undefined;
  const traceparent = buildTraceparent(traceContext.traceId, spanId);
  return traceparent === undefined ? undefined : { TRACEPARENT: traceparent };
}

/**
 * A fresh child environment: `base`, then Robota's trace, then `overrides`. When Robota's value
 * applies, the ambient `TRACESTATE` is dropped because it belongs to a different parent. When
 * `overrides` sets its own `TRACEPARENT`, Robota's value does not apply and `base` passes unchanged.
 * `base` itself is never modified.
 */
export function subprocessTraceEnvironment(
  base: Readonly<Record<string, string | undefined>>,
  traceEnv: ISubprocessTraceEnv | undefined,
  overrides: Readonly<Record<string, string>> = {},
): Record<string, string | undefined> {
  if (traceEnv === undefined || overrides['TRACEPARENT'] !== undefined) return { ...base, ...overrides };
  const { TRACESTATE: _ambientState, ...rest } = base;
  return { ...rest, ...traceEnv, ...overrides };
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
