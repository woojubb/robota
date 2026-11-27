---
'@robota-sdk/agent-product': minor
---

A connector sync reads on from a point it confirms instead of from the start of the last finished run. The run reads oldest first from that point (`syncRunInstructions` says so), and a new tool, `ConnectorSyncProgress` (`createSyncProgressTool`, named in `syncRunTools`), lets it report through which receipt time it fully handled and whether it reached the end; the host checks the report and moves the point only by it. `ConnectorSync` takes an optional hook that runs when a sync is turned off, so a host can forget what it kept for the connector.
