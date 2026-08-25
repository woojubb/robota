---
'@robota-sdk/agent-framework': patch
---

The CLI update-check cache is now written owner-only (`0600`) into an owner-only directory (`0700`), instead of inheriting the process umask.

SEC-020 made every writer into the CLI's own store owner-only and scoped this one file out as "not a session record", which left it the only file the product created there at `0644` under a permissive umask. The store directory is the confidentiality boundary and the file modes are the layer beneath it — an exception in that layer is only invisible while the layer above it holds.

The write now goes through `writeOwnerOnlyFile`, which creates the parent owner-only and sets the mode at creation rather than tightening afterwards, so the file never exists readable. A cache an older version left at `0644` is repaired at its next write.

`getUserUpdateCheckCachePath`, `readUpdateCheckCache`, `writeUpdateCheckCache` and `IUpdateCheckCache` moved to an internal `update-check-cache` module. **They are exported from the package root under the same names, so no import changes.**
