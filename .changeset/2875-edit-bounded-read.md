---
'@robota-sdk/agent-tools': patch
---

Bound Edit file input before materializing content, including when file size metadata is stale, and reject a replaceAll whose output would exceed the same ceiling before writing.
