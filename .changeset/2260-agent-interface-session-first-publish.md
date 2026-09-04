---
'@robota-sdk/agent-interface-session': minor
'@robota-sdk/agent-interface-transport': minor
---

`readAssistantReplies`, `readErrors`, `readLastAssistantText` and `readToolCalls` are exported from
`@robota-sdk/agent-interface-session`, which is now published alongside
`@robota-sdk/agent-interface-transport` (issue #2260).

The four helpers shipped from `agent-interface-transport@3.0.0-beta.79` and moved to the session
package on `develop` (ARCH-103..108), which was not yet on the registry. A consumer importing them
from the transport package migrates the import to `@robota-sdk/agent-interface-session`; the session
package is in the changeset fixed group, so it versions and publishes with the transport package.
