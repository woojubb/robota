# @robota-sdk/agent-telemetry-otel — Package Specification

## Purpose

Owns the mapping from a Robota live prompt trace to OpenTelemetry span names, kinds and attributes,
so every host that exports Robota traces — the CLI, an app, an SDK user's own tracer — names the same
facts the same way. The mapping is a pure function of the batch; recording and delivering spans
belong to the host that holds an OpenTelemetry SDK.

## Contract

- The projection carries only what the batch carries. A trace batch is content-free, and so is its
  projection: no prompt, completion, tool argument or tool result can appear in a span.
- Span identity is the batch's identity. Every span keeps the trace and span ID the batch minted, and
  every child's parent is the prompt root, so a projected trace joins the trace context Robota
  propagated to providers and subprocesses.
- `agent` mode is the naming the CLI's OTLP export has always used; a host switching to this package
  in that mode changes nothing a collector sees.
- In the GenAI modes a fact the GenAI conventions define uses the convention's name, and a fact they
  do not define keeps its `agent.*` name rather than being dropped or renamed into the `gen_ai`
  namespace.
- A name that cannot be determined is left out rather than guessed: the span name falls back to the
  bare operation, and an unknown provider gets no `gen_ai.provider.name`.

## Invariants

- No ambient state: the projection reads no environment variable, clock, global tracer or
  configuration, and two calls with the same batch and options return equal results.
- Opaque IDs (tool call, provider request) and tool names outside the shape the framework's trace
  boundary allows are dropped, even when a host passes a batch that bypassed that boundary.

## Non-goals

- Recording, batching or exporting spans, and choosing endpoints or headers.
- Metrics and logs.
- Content capture (`gen_ai.input.messages` and similar opt-in attributes).

## Design decisions

- **No OpenTelemetry dependency.** The output is plain data, so the package fits any OpenTelemetry
  SDK version or a host that writes OTLP itself, and a consumer that only needs the names does not
  install an SDK.
- **`gen_ai/dup` exists for migration.** The GenAI conventions are still in development; emitting
  both attribute sets under GenAI span names lets a backend move its queries before the `agent.*`
  attributes are dropped, the same staged opt-in the conventions themselves recommend.
- **Gemini maps to `gcp.gen_ai`.** A Gemini client can point at either the Gemini API or Vertex AI,
  and the trace does not say which, so the projection uses the conventions' name for any Google
  generative AI endpoint instead of claiming one.
