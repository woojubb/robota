---
'@robota-sdk/agent-session-analytics': minor
'@robota-sdk/agent-framework': patch
'@robota-sdk/agent-transport': patch
'@robota-sdk/agent-cli': patch
---

Relocate session feature logic out of the CLI shell and the transport (DQ-AUDIT-004):

- Extract session-log timing analysis into the new `@robota-sdk/agent-session-analytics` package (pure analysis over canonical session records — no duplicate types, no file I/O). `agent-cli`'s `session analyze` command shrinks to thin wiring and loads records via the new `createUserSessionStore()` / existing `createProjectSessionStore()` framework facades.
- Move LLM-based session auto-naming (`generateSessionName`) from `agent-transport/tui` into `agent-framework` (session-lifecycle owner); the TUI transport now invokes it through the framework.
