---
'@robota-sdk/agent-core': patch
---

Update Zod, OpenAI, and Undici to patched releases so installed Robota artifacts do not carry the
known production dependency vulnerabilities. The Zod schema bridge now preserves the supported
object, record, enum, literal, wrapper, and transform contracts on Zod 4, and the OpenAI-compatible
response parser safely ignores non-function tool-call variants introduced by the current SDK.
