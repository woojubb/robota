---
'@robota-sdk/agent-provider-openai-compatible': patch
---

Send `response_format` on the OpenAI-compatible request when the resolved model declares the
`json_schema` capability (PROV-004 / CORE-043).

The shared request builder — the one place that decides what a compat request carries — never
emitted `IChatOptions.responseFormat`, so a structured-output run against deepseek, qwen or gemma
carried no schema signal on the first attempt and depended entirely on the core-side prose retry
loop, which `outputRetries: 0` disables. Meanwhile deepseek's own capability table declared
`json_schema`, so the package asserted a capability its request path did not transport.

Emission is gated on the declared capability rather than unconditional: qwen's table omits
`json_schema`, gemma publishes no table, and the deployment targets this family documents include
servers that reject unknown parameters. A model that declares nothing keeps the previous behaviour.
