---
'@robota-sdk/agent-os': minor
'@robota-sdk/agent-executor': patch
'@robota-sdk/agent-framework': patch
'@robota-sdk/agent-session': patch
'@robota-sdk/agent-subagent-runner': patch
'@robota-sdk/agent-tools': patch
---

The host primitives are now one package, `@robota-sdk/agent-os`, with one subpath each: `file-authority` (and `file-authority/testing`), `node-lock` and `process`. Import the subpath you use (`@robota-sdk/agent-os/process`); there is no root export, and a bundle that imports `process` contains no native binding. Koffi is now an optional peer dependency pinned to `3.3.1`: a project that imports `file-authority` or `node-lock` installs it itself, and a project that imports only `process` installs nothing. The exported names and signatures are unchanged. `@robota-sdk/agent-file-authority`, `@robota-sdk/agent-node-lock` and `@robota-sdk/agent-process` no longer receive releases. The framework, session, tools, executor and subagent-runner packages depend on `@robota-sdk/agent-os`; the packages that used the file authority or the lock declare `koffi` themselves, so their installs are unchanged.
