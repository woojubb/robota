# @robota-sdk/agent-telemetry-otel

Maps a Robota live prompt trace onto OpenTelemetry span shapes. One `ILivePromptTraceBatch` (from
`@robota-sdk/agent-interface-analytics`) becomes a root span for the prompt and one child span per
provider call and tool body, with the batch's own trace and span IDs. The result is plain data: this
package does not depend on an OpenTelemetry SDK and never records or sends anything itself.

## Installation

```bash
npm install @robota-sdk/agent-telemetry-otel @robota-sdk/agent-interface-analytics
```

Requires Node.js 22.12 or later.

## Usage

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

## Documents

- [docs/README.md](./docs/README.md)
- [docs/SPEC.md](./docs/SPEC.md) — package contract and design decisions.
