---
'@robota-sdk/agent-cli': patch
'@robota-sdk/agent-file-authority': patch
'@robota-sdk/agent-tools': patch
'@robota-sdk/agent-transport-acp': patch
'@robota-sdk/agent-transport-http': patch
'@robota-sdk/agent-transport-webrtc': patch
---

Harden file, HTTP, relay, hosted-runtime, editor, and native path boundaries against resource exhaustion, short writes, path races, and integer narrowing.

Editor integrations now carry `Read`, `Write`, and `Edit` only when their `IEditorFileAccess` adapter declares `pathAuthority: 'stable-root'`; pathname-only adapters continue to receive disk-search notices, while file operations use the tools' stable disk authority. Existing adapters that can prove stable rooted access should add the marker to retain editor-buffer reads and writes.

`HttpDagRuntimeProvider` accepts a `token` option and applies it to every orchestration and event-stream request so it interoperates with the authenticated native DAG runtime server.
