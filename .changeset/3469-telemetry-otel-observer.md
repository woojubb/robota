---
'@robota-sdk/agent-telemetry-otel': minor
---

`createOtelTracing({ tracer, mode, idGenerator })` records an agent run's provider calls and tool bodies
as OpenTelemetry spans on the host's tracer, under the host's span, named as `projectLivePromptTrace`
names them. Register its `plugin` once on the agent, and pass each run the `traceContext` and
`onExecutionEvent` from `startRun(parentSpanContext, { allowedOrigins, subprocessClasses })`.
`createStructuralIdGenerator()` is an `IdGenerator` for the host's `TracerProvider` so each span is
recorded under the span ID Robota sent in `traceparent`. `@opentelemetry/api` is a peer dependency.
