/**
 * Trusted W3C trace context for a run's provider calls and child processes.
 *
 * A host that exports a trace for a prompt hands the run the trace it owns, the exact origins it
 * trusts with that trace's identifiers, and the subprocess classes it lets inherit them. Nothing
 * here is adopted from the ambient environment: the host decides, and a run without this context
 * sends nothing.
 */

/** A class of child process a host may let receive `TRACEPARENT`. */
export type TSubprocessTraceClass = 'shell' | 'hooks';

/** What one child process receives: exactly one environment variable, never `TRACESTATE`. */
export interface ISubprocessTraceEnv {
  readonly TRACEPARENT: string;
}

/** The trace a host hands one run. */
export interface IRunTraceContext {
  /** The host-owned trace ID (32 lowercase hex) every provider call of this run belongs to. */
  readonly traceId: string;
  /** The host's span under which each provider-call span is exported. */
  readonly parentSpanId: string;
  /** Exact origins (`scheme://host[:port]`) that may receive `traceparent`; may be empty. */
  readonly allowedOrigins: readonly string[];
  /**
   * Child-process classes that receive `TRACEPARENT` in their environment. Derived separately from
   * the origins, so a host may enable either without the other.
   */
  readonly subprocessClasses?: readonly TSubprocessTraceClass[];
  /**
   * Told when an invoked call's provider cannot carry trace context, and only when origins are
   * listed: a run that propagates to subprocesses alone has nothing to tell. Receives the provider ID only,
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
