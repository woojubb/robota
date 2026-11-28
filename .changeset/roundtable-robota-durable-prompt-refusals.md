---
'@robota-sdk/agent-roundtable-robota': patch
---

A durable (`recovery`) `sessionParticipant` now refuses a host-supplied `ask`, `permissionHandler` or `promptForApproval` with `recovery-unsupported` before any lease: such a wait happens outside the conversation and is lost when the process restarts. Approvals reach a durable participant as conversation wait requests.
