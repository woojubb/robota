---
'@robota-sdk/agent-cli': patch
---

A front end with a person in front can ask about an untrusted folder instead of being refused.
`robota trust status --json` reports the folder's trust state, whether a person can be asked, and
what trust would load. `robota daemon start --restricted-workspace` starts the daemon Restricted in a
folder that is not trusted yet, the choice that person made. A daemon reports whether it runs
Restricted: a Restricted start never reuses one with the project's configuration, and a plain start
in a folder trusted since never reuses a Restricted one; both refuse and name `robota daemon stop`. `pnpm gui:dev` asks at its terminal: trust the folder, start
Restricted, or quit.
