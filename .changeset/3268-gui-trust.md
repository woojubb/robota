---
'@robota-sdk/agent-cli': patch
---

A front end with a person in front can ask about an untrusted folder instead of being refused.
`robota trust status --json` reports the folder's trust state, whether a person can be asked, and
what trust would load. `robota daemon start --restricted-workspace` starts the daemon Restricted in a
folder that is not trusted yet, the choice that person made. A daemon reports whether it runs
Restricted, and a start reuses a running daemon only when its access matches; otherwise it refuses
and names `robota daemon stop`. `pnpm gui:dev` asks at its terminal: trust the folder, start
Restricted, or quit.
