---
'@robota-sdk/agent-cli': minor
'@robota-sdk/agent-framework': minor
'@robota-sdk/agent-session': patch
---

Live telemetry can name its spans with the OpenTelemetry GenAI semantic conventions. Set
`PRODUCT_TELEMETRY_SEMCONV` to `gen_ai` to export `invoke_agent`, `chat {model}` (client) and
`execute_tool {tool}` spans with `gen_ai.*` attributes, keeping Robota-only facts as `agent.*`; or to
`gen_ai/dup` to emit both attribute sets while dashboards move. The default, `agent`, exports exactly
the spans it did before. An unknown value, or the setting while neither traces nor metrics are exported,
refuses startup. Console traces under a GenAI mode print the same projected spans.

The live prompt trace now carries each tool body's name (the session's tool-body observation includes it
and the framework's live projection passes a label-safe name through); it reaches spans only under a
GenAI mode and is never written to session history.
