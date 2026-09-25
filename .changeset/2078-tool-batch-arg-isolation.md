---
'@robota-sdk/agent-core': patch
'@robota-sdk/agent-provider-anthropic': patch
'@robota-sdk/agent-provider-gemini': patch
---

A tool call whose arguments fail to decode to a JSON object (invalid JSON, or a `null`/scalar/array
root — including a stream truncated mid-argument) no longer breaks the rest of its batch or the round
after it. Every other call in the same batch still executes and gets its real result; the malformed
call gets a clear per-call error instead, naming the tool and call id, and the run continues rather
than rejecting. The Anthropic and Gemini providers no longer throw when building the next request
from a conversation that still carries that call's original malformed arguments.
