---
'@robota-sdk/agent-framework': major
'@robota-sdk/agent-interface-transport': major
'@robota-sdk/agent-transport-tui': patch
---

Remove the obsolete session-level permission and ask callback options and the stale
`permission-resolved` display event. Prompt requests now settle exclusively through the canonical
request events and session resolution methods, while leaf adapters fail closed when callbacks reject.
