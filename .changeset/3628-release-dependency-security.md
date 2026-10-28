---
'@robota-sdk/agent-core': patch
'@robota-sdk/dag-core': patch
'@robota-sdk/dag-node': patch
'@robota-sdk/dag-node-file-read': patch
'@robota-sdk/dag-node-file-write': patch
'@robota-sdk/dag-node-gemini-image-edit': patch
'@robota-sdk/dag-node-http-request': patch
'@robota-sdk/dag-node-image-loader': patch
'@robota-sdk/dag-node-image-source': patch
'@robota-sdk/dag-node-input': patch
'@robota-sdk/dag-node-instant-node': patch
'@robota-sdk/dag-node-llm-text': patch
'@robota-sdk/dag-node-multi-input': patch
'@robota-sdk/dag-node-ok-emitter': patch
'@robota-sdk/dag-node-seedance-video': patch
'@robota-sdk/dag-node-skill': patch
'@robota-sdk/dag-node-text-output': patch
'@robota-sdk/dag-node-text-template': patch
'@robota-sdk/dag-node-text-to-image': patch
'@robota-sdk/dag-node-tool': patch
'@robota-sdk/dag-node-transform': patch
'@robota-sdk/dag-node-utility-text': patch
'@robota-sdk/dag-nodes-default': patch
---

Update Zod, OpenAI, and Undici to patched releases so installed Robota artifacts do not carry the
known production dependency vulnerabilities. The Zod schema bridge now preserves the supported
object, record, enum, literal, wrapper, and transform contracts on Zod 4, and the OpenAI-compatible
response parser safely ignores non-function tool-call variants introduced by the current SDK.
