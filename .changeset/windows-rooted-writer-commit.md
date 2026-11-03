---
'@robota-sdk/agent-file-authority': patch
---

Commit Windows root-relative writes through `NtSetInformationFile`, so atomic replacement (and the Write and Edit tools built on it) works on Windows instead of failing with `WIN32_87`.
