---
'@robota-sdk/agent-mcp': patch
---

Discovery now carries a tool's declared behavior hints (`readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint`) as `annotations` on each discovered tool, so a host can sort tools into reading and writing from what the server claims. Only those four booleans are kept; a tool that declares none has no `annotations`.
