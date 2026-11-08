---
'@robota-sdk/agent-interface': minor
'@robota-sdk/agent-executor': patch
'@robota-sdk/agent-framework': patch
'@robota-sdk/agent-product': patch
'@robota-sdk/agent-session': patch
'@robota-sdk/agent-session-analytics': patch
'@robota-sdk/agent-subagent-runner': patch
'@robota-sdk/agent-telemetry-otel': patch
'@robota-sdk/agent-transport': patch
'@robota-sdk/agent-ui-terminal': patch
'@robota-sdk/agent-ui-web': patch
---

The contract packages are now one package, `@robota-sdk/agent-interface`, with one subpath per family: `session` (and `session/testing`), `session-mobility`, `command`, `execution`, `analytics`, `transport` (and `transport/testing`) and `tui`. Import the subpath of the family you use (`@robota-sdk/agent-interface/session`); there is no root export. `@robota-sdk/agent-core` is now an optional peer dependency: `analytics` and `tui` need nothing, and a project that imports another family installs `agent-core` itself (the SDK packages that import those families declare it). The exported names and signatures are unchanged. `@robota-sdk/agent-interface-session`, `-session-mobility`, `-command`, `-execution`, `-analytics`, `-transport` and `-tui` no longer receive releases. The SDK packages that import a contract depend on `@robota-sdk/agent-interface`.
