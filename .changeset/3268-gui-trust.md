---
'@robota-sdk/agent-cli': patch
---

A graphical front end can ask a person about an untrusted folder instead of being refused.
`robota trust status --json` reports the folder's trust state, whether a person can be asked, and
what trust would load. `robota daemon start --restricted-workspace` starts the daemon Restricted in a
folder that is not trusted yet — the choice a person made in front of the app — and refuses to hand
over a daemon that is already running with more. `pnpm gui:dev` asks at its terminal: trust the
folder, start Restricted, or quit.
