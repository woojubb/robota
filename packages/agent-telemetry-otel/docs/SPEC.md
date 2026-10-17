# @robota-sdk/agent-telemetry-otel — Package Specification

## Purpose

Owns how Robota's provider calls, tool bodies and prompts become OpenTelemetry spans and GenAI metric
samples: their names, kinds, units and attributes, and — for a host tracing a run directly — recording
spans on the host's tracer under the span IDs Robota propagated. Every host that exports Robota
telemetry, the CLI, an app or an SDK user's own tracer, names the same facts the same way.
Aggregating, exporting and delivering spans and metrics belong to the host's OpenTelemetry SDK.

## Contract

- The projection carries only what the batch carries. A trace batch is content-free, and so is its
  projection: no prompt, completion, tool argument or tool result can appear in a span or metric.
- Span identity is Robota's identity. Every span keeps the trace and span ID Robota minted and sent in
  `traceparent`, and every child's parent is the prompt root, so a recipient's spans join the trace.
  A host whose `TracerProvider` does not use the structural ID generator keeps the trace and parent
  but not the child span IDs, because the OpenTelemetry API cannot choose a span's ID.
- The run observer records a span only for a run the host started tracing under a sampled span —
  never for an agent run nested inside it — and a failure to record
  never changes the run: the span is lost, never the provider call or tool result.
- `agent` mode is the naming the CLI's OTLP export has always used; a host switching to this package
  in that mode changes nothing a collector sees.
- In the GenAI modes a fact the GenAI conventions define uses the convention's name, and a fact they
  do not define keeps its `agent.*` name rather than being dropped or renamed into the `gen_ai`
  namespace.
- Nothing is guessed: a name that cannot be determined is left out — the span name falls back to the
  bare operation, and an unknown provider gets no `gen_ai.provider.name` on a span or a metric — and a
  metric the batch cannot prove is not produced. Provider-derived samples need every provider child
  present and tool-derived ones every tool child, because a bounded child list cannot support a total;
  usage that was not received counts as 0, as the conventions specify, never as a missing sample.

## Invariants

- No ambient state: nothing reads an environment variable, a global tracer or configuration; the
  projections also read no clock, and two calls with the same batch and options return equal results.
- Opaque IDs (tool call, provider request) and tool names outside the shape the framework's trace
  boundary allows are dropped, even when a host passes a batch that bypassed that boundary.

## Non-goals

- Batching, aggregating or exporting spans and metrics, choosing endpoints or headers, and creating
  the host's root span.
- Logs, and any metric outside the GenAI conventions.
- Content capture (`gen_ai.input.messages` and similar opt-in attributes).

## Design decisions

- **The OpenTelemetry API only, as a peer.** The package records through the host's `Tracer` and
  declares the SDK's `IdGenerator` structurally, so it fits any SDK version and never brings a second
  copy of the API's global state.
- **A standing plugin, per-run callbacks.** Agent-core reports a provider call's completion only to the
  run's `onExecutionEvent`, and a tool body's minted ID and timing only to plugin tool hooks, which
  are agent configuration. One plugin serves every run and attributes a tool body to the run whose
  execution ID it carries, so an agent built once can trace each run under a different host span.
- **Chosen span IDs through the ID generator.** The OpenTelemetry API has no way to give a span a
  chosen ID, and Robota must fix the ID before the operation so it can send it; a generator that
  returns a queued ID for exactly the next span is the one point where the two meet.
- **`gen_ai/dup` exists for migration.** The GenAI conventions are still in development; emitting
  both attribute sets under GenAI span names lets a backend move its queries before the `agent.*`
  attributes are dropped, the same staged opt-in the conventions themselves recommend.
- **Samples, not a recorder.** Metrics are plain samples rather than calls on a `Meter`: a host that
  exports one delta per prompt has no long-lived meter provider to record on, and the definitions
  (names, units, buckets, attributes) stay in one place beside the span projection, so both share the
  provider-name map. The definitions follow one fixed revision of the still-developing conventions,
  which the source names, so a host sees changes only when this package changes.
- **Gemini maps to `gcp.gen_ai`.** A Gemini client can point at either the Gemini API or Vertex AI,
  and the trace does not say which, so the projection uses the conventions' name for any Google
  generative AI endpoint instead of claiming one.
