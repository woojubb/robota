---
'@robota-sdk/agent-cli': patch
---

On a host that cannot prove a project write stays inside the project (every platform but Linux), a
trusted workspace no longer composes project memory, whose every save would be refused there. Memory
is shared through the repository, so it is not moved to a per-user store: turning it on prints once
that it stays off and why, and the run continues instead of failing on the first capture. Linux is
unchanged.
