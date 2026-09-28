---
'@robota-sdk/agent-core': patch
'@robota-sdk/agent-plugin': patch
---

Dispatch tool-call plugin hooks around each decoded attempt, including unknown-tool refusals,
and emit the event emitter plugin's before-execution event. A pre-effect wait resumes the same
logical call without repeating its before hooks; recovered results do not replay call hooks.

Pair parallel tool analytics by the logical execution ID, including calls of the same tool.
