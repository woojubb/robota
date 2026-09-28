---
'@robota-sdk/agent-session': patch
---

Apply command-hook PreToolUse input rewrites only after every enforcing hook evaluates the final
input. Permission checks and tool execution share those arguments; rewrite cycles and replacements
that a delegated or already-settled action cannot apply are refused.
