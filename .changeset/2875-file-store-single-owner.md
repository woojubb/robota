---
'@robota-sdk/dag-adapters-local': patch
'@robota-sdk/dag-framework': patch
---

Enforce `FileStoragePort`'s single-file-adapter-owner contract with an exclusive, `O_EXCL`-created
lock file in the storage root, acquired before any hydration or persistence. A second live instance
opened over an already-owned root now fails immediately with a typed `FileStoreOwnerConflictError`
instead of silently losing the live owner's writes; a lock left by a same-host process that is no
longer running is taken over automatically, and a lock recorded by a different host is never taken
over (this host cannot verify whether that owner is still alive). `FileStoragePort` gains a `close()`
method that releases ownership — call it (or let process exit release it, best-effort) before opening
another instance over the same root. `createDagFramework`'s `stop()` now releases its file storage
owner lock.
