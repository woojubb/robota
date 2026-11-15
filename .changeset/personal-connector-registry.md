---
'@robota-sdk/agent-product': patch
---

The personal pack gains connectors: a record of each external service the person connected (kind, endpoint, public sign-in settings, per-tool decisions) with no credential in it, a protocol port a host implements, a registry that sorts every tool into reading, writing or blocked (a tool is read only when the person said so or the service declared it read-only), and three tools for the agent (`ConnectorList`, `ConnectorRead`, `ConnectorAct`). A write is held for the person in every permission mode.
