---
'@robota-sdk/agent-cli': patch
---

`daemon start` hands the daemon its transport token over an inherited pipe instead of its environment, so the token no longer appears in the daemon's initial environment, which every program of the same OS user can read. The daemon reads it before starting anything else and refuses to start without it.
