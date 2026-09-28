---
'@robota-sdk/agent-transport': patch
---

`chunkHandoffPayload` and `HandoffChunkAssembler`, exported from the package root that also builds for the browser, no longer use Node's `Buffer`; they use `Uint8Array`, `TextEncoder`/`TextDecoder` and `btoa`/`atob`, with the same chunks and the same refusal of non-canonical base64.
