---
'@robota-sdk/agent-core': patch
---

Apply `config.systemMessage` on the streaming path. `runStream()` built its provider request straight
from the conversation store and never entered the session initialization that attaches the system
prompt, so an agent obeyed its persona through `run()` and ignored it through `runStream()` — silently,
on the default interactive surface. An agent used through both entry points only acquired its prompt
from the first non-streaming turn onward.

The streaming path now enters the same `initializeConversationStore` the round path enters, so the
prompt, the inject-once rule and the conversation restore are owned in one place. Contained under
CORE-042, which is the duplication itself.
