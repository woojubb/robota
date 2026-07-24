---
'@robota-sdk/agent-tools': patch
---

CLI-042: parallelize the Grep built-in tool's per-file content scan with bounded
concurrency (`p-limit(50)`), following the glob-tool precedent. Results are still
collected in file-enumeration order, so output is byte-identical to the previous
sequential implementation (verified against a pre-change golden on a 1,201-file
corpus); `headLimit` truncation and binary/unreadable-file skipping are unchanged.
