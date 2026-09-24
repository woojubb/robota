/**
 * Trusted W3C trace context for provider calls.
 *
 * A host that exports a trace for a prompt hands the run the trace it owns and the exact origins it
 * trusts with that trace's identifiers. Nothing here is adopted from the ambient environment: the
 * host decides, and a run without this context sends nothing.
 */
export interface IRunTraceContext {
  /** The host-owned trace ID (32 lowercase hex) every provider call of this run belongs to. */
  readonly traceId: string;
  /** The host's span under which each provider-call span is exported. */
  readonly parentSpanId: string;
  /** Exact origins (`scheme://host[:port]`) that may receive `traceparent`. */
  readonly allowedOrigins: readonly string[];
  /**
   * Told when an invoked call's provider cannot carry trace context. Receives the provider ID only,
   * never an origin, URL or identifier, so a host can surface it without disclosing either.
   */
  readonly onPropagationUnavailable?: (providerId: string) => void;
}

/** What one invoked provider call carries: the header value and where it may go. */
export interface IOutboundTraceContext {
  /** `00-<trace-id>-<provider-call-span-id>-01`. */
  readonly traceparent: string;
  /** Exact origins the adapter may send `traceparent` to; any other origin gets nothing. */
  readonly allowedOrigins: readonly string[];
}
