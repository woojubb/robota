---
'@robota-sdk/agent-framework': patch
---

Create settings files owner-only (SEC-003, CodeQL `js/insecure-temporary-file`).

`writeSettings` persists `provider.apiKey` verbatim when a profile is configured without
`--api-key-env` — the CLI even warns that the key is "stored as plain text in settings" — but the
file was created with the process umask (measured `0644`/`0664`), leaving that credential readable
by every user on the host. It is now created `0600`.

This is a permissions change only — file locations, names, formats, and APIs are unchanged. `mode`
applies at creation, so a settings file that already exists keeps whatever mode it has; only newly
created settings files are affected.
