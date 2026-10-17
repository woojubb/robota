# @robota-sdk/agent-telemetry-otel

OpenTelemetry tracing and GenAI metrics for Robota agents, in three forms:

- **`createOtelTracing`** records an agent run's provider calls and tool bodies as spans on your own
  tracer, under your span, with the span IDs Robota sent to providers and subprocesses in `traceparent`.
- **`projectLivePromptTrace`** maps one `ILivePromptTraceBatch` (from
  `@robota-sdk/agent-interface-analytics`) onto span shapes as plain data, for a host that writes
  spans itself.
- **`projectLivePromptMetricSamples`** maps the same batch onto the OpenTelemetry GenAI metrics as plain
  samples, for a host that records or exports metrics itself.

All are content-free: no prompt, completion, tool argument or tool result becomes a span or metric
attribute. None exports anything; your OpenTelemetry SDK and exporter do.

## Installation

```bash
npm install @robota-sdk/agent-telemetry-otel @opentelemetry/api
```

Requires Node.js 22.12 or later.

## Tracing a run

```typescript
import { ConversationAgent } from '@robota-sdk/agent-core';
import { TracerProvider, BatchSpanProcessor } from '@opentelemetry/sdk-trace';
import { createOtelTracing, createStructuralIdGenerator } from '@robota-sdk/agent-telemetry-otel';

const idGenerator = createStructuralIdGenerator();
const provider = new TracerProvider({ idGenerator, spanProcessors: [new BatchSpanProcessor({ exporter })] });
const tracer = provider.getTracer('my-app');

const tracing = createOtelTracing({ tracer, idGenerator, mode: 'gen_ai' });
const agent = new ConversationAgent({ /* ... */, plugins: [tracing.plugin] });

const span = tracer.startSpan('invoke_agent my-agent');
const run = tracing.startRun(span.spanContext(), { allowedOrigins: ['https://api.anthropic.com'] });
try {
  await agent.run(prompt, { traceContext: run.traceContext, onExecutionEvent: run.onExecutionEvent });
} finally {
  run.end();
  span.end();
}
```

Register `tracing.plugin` once; it records tool bodies for every run started with `startRun`. Each
run's provider calls come from its `onExecutionEvent`, so pass the run's callback to that run (wrap
it if you also handle execution events). The host span is yours: name it, add `gen_ai.agent.name` or
`gen_ai.conversation.id`, and end it.

`allowedOrigins` lists the exact origins that may receive `traceparent`; with none, provider calls
send nothing and are still traced. `subprocessClasses: ['shell', 'hooks']` lets shell children and
command hooks inherit the trace.

**Span IDs.** Robota fixes each provider call's and tool body's span ID before the operation runs,
so a recipient's spans name it as their parent. `createStructuralIdGenerator()` lets your
`TracerProvider` record the span under that ID; it gives every other span a random one. Without it,
spans still share your trace and parent, but a recipient's spans point at a span ID your trace does
not contain.

## Projecting a trace batch

```typescript
import { projectLivePromptTrace } from '@robota-sdk/agent-telemetry-otel';

// `batch` is an ILivePromptTraceBatch, e.g. from the framework's `livePromptTrace` port.
const { schemaUrl, root, children } = projectLivePromptTrace(batch, {
  mode: 'gen_ai',
  agentName: 'my-agent',
});
// root:     { name: 'invoke_agent my-agent', kind: 'internal', traceId, spanId, startedAt, endedAt, status, attributes }
// children: [{ name: 'chat claude-sonnet-4-5', kind: 'client', parentSpanId: root.spanId, ... }, ...]
```

Each span carries `name`, `kind` (`internal` or `client`), `traceId`, `spanId`, `parentSpanId`
(children only), `startedAt` and `endedAt` (ISO timestamps), `status` (`error` for a failed
outcome) and `attributes`. Permission decisions in the batch get no span.

## Modes

| Mode         | Span names                                                         | Attributes                                                                                                                                                                         |
| ------------ | ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `agent`      | `agent.prompt_execution`, `agent.provider_call`, `agent.tool_body` | Robota's `agent.*` names, as the CLI's OTLP export uses them                                                                                                                       |
| `gen_ai`     | `invoke_agent {agent}`, `chat {model}`, `execute_tool {tool}`      | OpenTelemetry GenAI `gen_ai.*` names where the conventions define the fact; Robota-only facts (turn, outcome, timing, omitted counts, usage provenance, request ID) stay `agent.*` |
| `gen_ai/dup` | GenAI names                                                        | Both sets, so dashboards can move from one to the other                                                                                                                            |

In the GenAI modes the provider-call span is `client` and `schemaUrl` is `GEN_AI_SCHEMA_URL`, the
GenAI semantic-convention version the names follow. `gen_ai.provider.name` is set only for providers
whose GenAI name is certain; `agent.provider.id` always names the Robota provider.

## Metrics

```typescript
import { projectLivePromptMetricSamples } from '@robota-sdk/agent-telemetry-otel';

const samples = projectLivePromptMetricSamples(batch, { mode: 'gen_ai', agentName: 'my-agent' });
// [{ name: 'gen_ai.client.inference.duration', instrument: 'histogram', unit: 's',
//    value: 1.2, boundaries: [0.01, ...], attributes: { 'gen_ai.operation.name': 'chat', ... } }, ...]
```

Each sample is one measurement: a `counter` increment, or a `histogram` value with the explicit
`boundaries` the GenAI conventions recommend. Record each on an instrument of that name, unit and
boundaries; the attributes are the measurement's labels. `mode` is `gen_ai` or `gen_ai/dup`, as for
spans (there is no `agent` form of these metrics).

| Metric                                                              | Instrument, unit       | Per                   |
| ------------------------------------------------------------------- | ---------------------- | --------------------- |
| `gen_ai.client.inference.duration`                                  | histogram, `s`         | invoked provider call |
| `gen_ai.client.inference.operation.input_tokens` / `.output_tokens` | histogram, `{token}`   | invoked provider call |
| `gen_ai.client.inference.usage.input_tokens` / `.output_tokens`     | counter, `{token}`     | invoked provider call |
| `gen_ai.execute_tool.duration`                                      | histogram, `s`         | tool body             |
| `gen_ai.invoke_agent.duration`                                      | histogram, `s`         | prompt                |
| `gen_ai.invoke_agent.inference_calls` / `.tool_calls`               | histogram, call counts | prompt                |

Cache hits and refused calls are not inferences and produce nothing, and neither do permission
decisions. A call whose usage was not fully received records `0` tokens under the `unknown` modality,
as the conventions specify. Samples that need every provider (or tool) child are left out when the
batch omitted any, so a bounded batch never yields a total that looks complete. `gen_ai.request.model`
and `gen_ai.tool.name` appear only when label-safe, and `gen_ai.provider.name` only for providers whose
GenAI name is certain. As on the provider span, the inference samples also keep the label-safe
`agent.provider.id` (the conventions do not define it, so a provider outside the known map can still be
told apart) and, in `gen_ai/dup` only, `agent.model.id`. The bucket constants (`GEN_AI_DURATION_BUCKETS_S`
and the others) are exported.

## Documents

- [docs/README.md](./docs/README.md)
- [docs/SPEC.md](./docs/SPEC.md) — package contract and design decisions.
