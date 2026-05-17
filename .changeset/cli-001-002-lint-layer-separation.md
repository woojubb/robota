---
'@robota-sdk/agent-cli': patch
'@robota-sdk/agent-framework': patch
'@robota-sdk/agent-command': patch
'@robota-sdk/agent-transport': patch
---

refactor: CLI-001/002 — agent-cli layer separation and monorepo-wide readability lint rules

- CLI-001: Extract startup phases into focused modules; enforce agent-cli layer separation
- CLI-002: Apply import/order, consistent-type-imports, explicit-function-return-type, prefer-const, object-shorthand across all packages
- Fix stale child-process-subagent-worker entry in agent-cli tsdown.config.ts (build fix)
