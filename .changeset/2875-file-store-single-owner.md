---
'@robota-sdk/dag-adapters-local': patch
'@robota-sdk/dag-framework': patch
---

Enforce `FileStoragePort`'s single-file-adapter-owner contract with an exclusive, `O_EXCL`-created
lock file in the storage root, acquired before any hydration or persistence. A second live instance
opened over an already-owned root now fails immediately with a typed `FileStoreOwnerConflictError`
instead of silently losing the live owner's writes.

Ownership is a renewed heartbeat lease, not a one-shot claim, so it self-heals in the situations
same-host pid liveness alone cannot: a lock whose lease has lapsed is taken over regardless of which
host or process recorded it — including a container recreated after `docker stop`/a crash, which gets
a new hostname and never runs Node's `exit` handler on SIGTERM/SIGKILL, and a same-host pid reused by
an unrelated process. A same-host owner found to no longer be running is still taken over immediately
as a fast path, without waiting out the full lease. An owner whose lease is reclaimed out from under
it during a long stall notices on its next renewal and stops accepting further reads and writes,
rather than continuing unaware as a second, unaccounted-for owner.

`FileStoragePort` gains a `close()` method that releases ownership — call it (or let process exit
release it, best-effort) before opening another instance over the same root. `createDagFramework`'s
`stop()` now releases its file storage owner lock.
