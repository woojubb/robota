---
'@robota-sdk/agent-cli': patch
---

Require hosted admission protocol v2 with signed root-task ownership. Add a pinned E2B SDK connector that checks admitted worker ownership and network configuration before connecting, keeps management credentials outside task operations, and retains provider teardown failures.
