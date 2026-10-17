---
'@robota-sdk/agent-cli': minor
'@robota-sdk/agent-telemetry-otel': minor
---

Live telemetry can name its metrics with the OpenTelemetry GenAI semantic conventions. With
`PRODUCT_TELEMETRY_SEMCONV` set to `gen_ai`, the metrics export the `gen_ai.client.inference.*`
duration, token-usage and per-call token histograms, `gen_ai.execute_tool.duration` and
`gen_ai.invoke_agent.*` duration and call counts, and drop only `agent.provider.input_tokens` and
`agent.provider.output_tokens`, which the GenAI usage counters replace exactly. `gen_ai/dup` exports
every `agent.*` metric and the GenAI ones. The default, `agent`, exports exactly the metrics it did
before. Provider- and tool-derived GenAI metrics are exported only when no such child was omitted, and
usage that was not received is recorded as 0 under the `unknown` modality, as the conventions specify.
The GenAI metrics carry the requested model as those conventions require, and their inference points
also take the `agent.provider.id` and `agent.model.id` labels under the same
`PRODUCT_TELEMETRY_METRIC_ATTRIBUTES` opt-ins as the `agent.*` metrics (the model only in `gen_ai/dup`),
so a provider split of token totals survives the dropped counters. `PRODUCT_TELEMETRY_SEMCONV` now applies to
traces and metrics, and is refused only when neither is exported over otlp or console. Console metrics
print the same projection.

`@robota-sdk/agent-telemetry-otel` adds `projectLivePromptMetricSamples`, which maps a live prompt trace
batch onto those GenAI metrics as plain, SDK-free samples with the recommended bucket boundaries, so
every host names and measures the same facts the same way. Its inference samples keep the label-safe
`agent.provider.id`, and `agent.model.id` in `gen_ai/dup`, as the provider span does.
