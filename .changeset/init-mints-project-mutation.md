---
'@robota-sdk/agent-cli': patch
---

`init` now writes the starter `AGENTS.md`, the project settings and the runtime-data ignore rules in a trusted folder. The stock command refused every time with "requires project mutation permission", because only an embedding host could supply that permission and the CLI never did; a host that supplies its own bounded capability keeps it. On a host that cannot prove a project write stays under the trusted root the write is still refused.
