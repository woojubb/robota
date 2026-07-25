---
'@robota-sdk/agent-provider-openai': patch
'@robota-sdk/agent-session': patch
---

Harden on-disk log permissions against CWE-377 (SEC-003, CodeQL `js/insecure-temporary-file`).

Session logs, externalized session payloads, and OpenAI request/response payload logs all carry
conversation and prompt content, but were created with the process umask (typically `0644`) inside a
caller-supplied directory that may be shared or world-writable. They are now created owner-only
(`0600`), and the directories that hold them are created `0700`.

This is a permissions change only — file locations, names, formats, and APIs are unchanged. Anything
that read these logs as a _different_ OS user will no longer be able to; the owning user is
unaffected.
