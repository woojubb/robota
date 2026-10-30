# @robota-sdk/agent-telemetry-otel

## 3.0.3
### Patch Changes

  - @robota-sdk/agent-core@3.0.3
  - @robota-sdk/agent-interface-analytics@3.0.3

## 3.0.2
### Patch Changes

  - @robota-sdk/agent-core@3.0.2
  - @robota-sdk/agent-interface-analytics@3.0.2

## 3.0.1
### Patch Changes

  - @robota-sdk/agent-core@3.0.1
  - @robota-sdk/agent-interface-analytics@3.0.1

## 3.0.0
### Minor Changes

- ccf4194: `createOtelTracing({ tracer, mode, idGenerator })` records an agent run's provider calls and tool bodies
  as OpenTelemetry spans on the host's tracer, under the host's span, named as `projectLivePromptTrace`
  names them. Register its `plugin` once on the agent, and pass each run the `traceContext` and
  `onExecutionEvent` from `startRun(parentSpanContext, { allowedOrigins, subprocessClasses })`.
  `createStructuralIdGenerator()` is an `IdGenerator` for the host's `TracerProvider` so each span is
  recorded under the span ID Robota sent in `traceparent`. `@opentelemetry/api` is a peer dependency.
- fef3a50: New package `@robota-sdk/agent-telemetry-otel`. `projectLivePromptTrace(batch, { mode, agentName })`
  maps one live prompt trace batch onto content-free OpenTelemetry span shapes without depending on an
  OpenTelemetry SDK. `mode: 'agent'` keeps Robota's `agent.*` span and attribute names; `mode: 'gen_ai'`
  uses the OpenTelemetry GenAI semantic conventions (`invoke_agent`, `chat`, `execute_tool`, `gen_ai.*`
  attributes, `GEN_AI_SCHEMA_URL`) and keeps Robota-only facts such as timing and outcome as `agent.*`;
  `mode: 'gen_ai/dup'` emits both attribute sets under GenAI span names for a gradual migration.

  `IToolBodyTraceEntry` gains an optional live-only `toolName`, which the GenAI projection uses for the
  `execute_tool` span name and `gen_ai.tool.name`.
- ccff111: Live telemetry can name its metrics with the OpenTelemetry GenAI semantic conventions. With
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

### Patch Changes

- Updated dependencies [7b6234c]
- Updated dependencies [4eea54b]
- Updated dependencies [3c81769]
- Updated dependencies [1698be4]
- Updated dependencies [d4189b9]
- Updated dependencies [9edae52]
- Updated dependencies [4078a72]
- Updated dependencies [4c73a0b]
- Updated dependencies [196a900]
- Updated dependencies [f336838]
- Updated dependencies [34e50f0]
- Updated dependencies [722e88a]
- Updated dependencies [d23c848]
- Updated dependencies [3038eb7]
- Updated dependencies [02b7452]
- Updated dependencies [e689c8e]
- Updated dependencies [ec5e477]
- Updated dependencies [c7f9203]
- Updated dependencies [be0e53c]
- Updated dependencies [8bd5fac]
- Updated dependencies [57280bf]
- Updated dependencies [5033dd9]
- Updated dependencies [18c0d5c]
- Updated dependencies [dbd888d]
- Updated dependencies [1887e54]
- Updated dependencies [9f46375]
- Updated dependencies [41cca13]
- Updated dependencies [ada3841]
- Updated dependencies [5093a30]
- Updated dependencies [94b2c87]
- Updated dependencies [3ab2eca]
- Updated dependencies [2c612ba]
- Updated dependencies [66af868]
- Updated dependencies [fef3a50]
- Updated dependencies [04a6de4]
- Updated dependencies [0ba247b]
- Updated dependencies [6f41c53]
- Updated dependencies [fec722f]
- Updated dependencies [2d3b2c0]
- Updated dependencies [4772067]
- Updated dependencies [9fbab1b]
- Updated dependencies [a009f5b]
- Updated dependencies [c207a31]
- Updated dependencies [9b4f63b]
- Updated dependencies [4f3c075]
- Updated dependencies [475e085]
- Updated dependencies [e477440]
- Updated dependencies [9dcb5da]
- Updated dependencies [a95ca85]
- Updated dependencies [b6d14ce]
- Updated dependencies [0382a51]
- Updated dependencies [93d061d]
- Updated dependencies [39554a1]
- Updated dependencies [d28430a]
- Updated dependencies [7d9cc66]
- Updated dependencies [7d9cc66]
- Updated dependencies [7d9cc66]
- Updated dependencies [df02568]
- Updated dependencies [07b627f]
- Updated dependencies [d0de5b2]
- Updated dependencies [9c6a8db]
- Updated dependencies [9c6a8db]
- Updated dependencies [dfb9b15]
- Updated dependencies [7d9cc66]
- Updated dependencies [7d9cc66]
- Updated dependencies [d6b9404]
- Updated dependencies [62663ae]
- Updated dependencies [23a30cd]
- Updated dependencies [7d9cc66]
- Updated dependencies [9814afc]
- Updated dependencies [7d9cc66]
- Updated dependencies [02053ec]
  - @robota-sdk/agent-core@3.0.0
  - @robota-sdk/agent-interface-analytics@3.0.0

## 3.0.0-beta.106
### Patch Changes

  - @robota-sdk/agent-core@3.0.0-beta.106
  - @robota-sdk/agent-interface-analytics@3.0.0-beta.106

## 3.0.0-beta.105
### Patch Changes

  - @robota-sdk/agent-core@3.0.0-beta.105
  - @robota-sdk/agent-interface-analytics@3.0.0-beta.105

## 3.0.0-beta.104
### Patch Changes

  - @robota-sdk/agent-core@3.0.0-beta.104
  - @robota-sdk/agent-interface-analytics@3.0.0-beta.104

## 3.0.0-beta.103
### Patch Changes

- Updated dependencies [6f41c53]
  - @robota-sdk/agent-core@3.0.0-beta.103
  - @robota-sdk/agent-interface-analytics@3.0.0-beta.103

## 3.0.0-beta.102
### Patch Changes

  - @robota-sdk/agent-core@3.0.0-beta.102
  - @robota-sdk/agent-interface-analytics@3.0.0-beta.102

## 3.0.0-beta.101
### Patch Changes

- Updated dependencies [62663ae]
  - @robota-sdk/agent-core@3.0.0-beta.101
  - @robota-sdk/agent-interface-analytics@3.0.0-beta.101

## 3.0.0-beta.100
### Patch Changes

  - @robota-sdk/agent-core@3.0.0-beta.100
  - @robota-sdk/agent-interface-analytics@3.0.0-beta.100

## 3.0.0-beta.99
### Patch Changes

  - @robota-sdk/agent-core@3.0.0-beta.99
  - @robota-sdk/agent-interface-analytics@3.0.0-beta.99

## 3.0.0-beta.98
### Patch Changes

  - @robota-sdk/agent-core@3.0.0-beta.98
  - @robota-sdk/agent-interface-analytics@3.0.0-beta.98

## 3.0.0-beta.97
### Patch Changes

- Updated dependencies [c207a31]
- Updated dependencies [9b4f63b]
- Updated dependencies [23a30cd]
  - @robota-sdk/agent-core@3.0.0-beta.97
  - @robota-sdk/agent-interface-analytics@3.0.0-beta.97

## 3.0.0-beta.96
### Patch Changes

  - @robota-sdk/agent-core@3.0.0-beta.96
  - @robota-sdk/agent-interface-analytics@3.0.0-beta.96

## 3.0.0-beta.95
### Patch Changes

- Updated dependencies [04a6de4]
- Updated dependencies [0ba247b]
- Updated dependencies [02053ec]
  - @robota-sdk/agent-core@3.0.0-beta.95
  - @robota-sdk/agent-interface-analytics@3.0.0-beta.95

## 3.0.0-beta.94
### Minor Changes

- ccf4194: `createOtelTracing({ tracer, mode, idGenerator })` records an agent run's provider calls and tool bodies
  as OpenTelemetry spans on the host's tracer, under the host's span, named as `projectLivePromptTrace`
  names them. Register its `plugin` once on the agent, and pass each run the `traceContext` and
  `onExecutionEvent` from `startRun(parentSpanContext, { allowedOrigins, subprocessClasses })`.
  `createStructuralIdGenerator()` is an `IdGenerator` for the host's `TracerProvider` so each span is
  recorded under the span ID Robota sent in `traceparent`. `@opentelemetry/api` is a peer dependency.
- fef3a50: New package `@robota-sdk/agent-telemetry-otel`. `projectLivePromptTrace(batch, { mode, agentName })`
  maps one live prompt trace batch onto content-free OpenTelemetry span shapes without depending on an
  OpenTelemetry SDK. `mode: 'agent'` keeps Robota's `agent.*` span and attribute names; `mode: 'gen_ai'`
  uses the OpenTelemetry GenAI semantic conventions (`invoke_agent`, `chat`, `execute_tool`, `gen_ai.*`
  attributes, `GEN_AI_SCHEMA_URL`) and keeps Robota-only facts such as timing and outcome as `agent.*`;
  `mode: 'gen_ai/dup'` emits both attribute sets under GenAI span names for a gradual migration.

  `IToolBodyTraceEntry` gains an optional live-only `toolName`, which the GenAI projection uses for the
  `execute_tool` span name and `gen_ai.tool.name`.
- ccff111: Live telemetry can name its metrics with the OpenTelemetry GenAI semantic conventions. With
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

### Patch Changes

- Updated dependencies [fef3a50]
  - @robota-sdk/agent-interface-analytics@3.0.0-beta.94
  - @robota-sdk/agent-core@3.0.0-beta.94
