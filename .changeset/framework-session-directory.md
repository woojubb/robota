---
'@robota-sdk/agent-framework': minor
---

`createServeSessionDirectory` gives each client of a served session pool its own view of the sessions: listing them, switching, starting a new one, renaming and deleting, with refusals carrying codes. It is the directory `robota --serve` uses, moved into the framework so every composition root that serves a session pool shares one implementation.
