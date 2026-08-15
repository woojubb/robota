---
'@robota-sdk/agent-core': minor
'@robota-sdk/agent-executor': minor
---

Make shell resolution executable-aware across managed and scheduled background command runners. The core
resolver now accepts one request with explicit-executable precedence, returns matching argument families
for sh/bash, PowerShell/pwsh, and cmd, and fails closed with `UnsupportedShellError` for unknown explicit
executables. Executor exposes one shared request adapter and both concrete runners consume its pair.
