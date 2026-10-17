---
'@robota-sdk/agent-telemetry-otel': minor
'@robota-sdk/agent-interface-analytics': minor
---

New package `@robota-sdk/agent-telemetry-otel`. `projectLivePromptTrace(batch, { mode, agentName })`
maps one live prompt trace batch onto content-free OpenTelemetry span shapes without depending on an
OpenTelemetry SDK. `mode: 'agent'` keeps Robota's `agent.*` span and attribute names; `mode: 'gen_ai'`
uses the OpenTelemetry GenAI semantic conventions (`invoke_agent`, `chat`, `execute_tool`, `gen_ai.*`
attributes, `GEN_AI_SCHEMA_URL`) and keeps Robota-only facts such as timing and outcome as `agent.*`;
`mode: 'gen_ai/dup'` emits both attribute sets under GenAI span names for a gradual migration.

`IToolBodyTraceEntry` gains an optional live-only `toolName`, which the GenAI projection uses for the
`execute_tool` span name and `gen_ai.tool.name`.
