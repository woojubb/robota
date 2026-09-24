---
'@robota-sdk/dag-adapters-local': minor
'@robota-sdk/dag-framework': patch
---

Enforce `FileStoragePort`'s single-file-adapter-owner contract with an exclusive, atomically-created
lock file in the storage root, acquired before any hydration or persistence. A second live instance
opened over an already-owned root now fails immediately with a typed `FileStoreOwnerConflictError`
instead of silently losing the live owner's writes. Creation publishes the lock file atomically (a
fully-written temp file, then linked into place), so it is never visible partially written.

Ownership is a renewed heartbeat lease, not a one-shot claim, so it self-heals in situations same-host
pid liveness alone cannot: a lock whose lease has lapsed is taken over regardless of which host or
process recorded it — including a container recreated after `docker stop`/a crash, which gets a new
hostname and never runs Node's `exit` handler on SIGTERM/SIGKILL, and a same-host pid reused by an
unrelated process. A same-host owner found to no longer be running is still taken over immediately as
a fast path, without waiting out the full lease. Takeover of a stale lock is serialized by a short-lived
guard file, so concurrent takers cannot both believe they won.

An owner whose lease is reclaimed out from under it during a long stall notices on its next renewal
and stops accepting further reads and writes, rather than continuing unaware as a second,
unaccounted-for owner. It also stops itself proactively: it tracks its own last successful renewal and
refuses further reads and writes once that is old enough that another opener could legitimately treat
its lease as expired, closing the lost-update window a heartbeat that keeps failing to write (an
unwritable directory, a stalled event loop) would otherwise leave open. Losing the lock this way is not
necessarily permanent — the next operation checks whether nothing actually took over (the lock still
names this instance) or the root can be freshly reacquired, and resumes if so; it stays refused only
when a live, different owner now holds it.

`FileStoragePort` gains a `close()` method that releases ownership; closing is final — every later
operation on that instance rejects with a typed `FileStoragePortClosedError`. `close()` waits for any
queued write and any in-flight acquisition to settle before releasing. `createDagFramework`'s `stop()`
releases the file storage owner lock it created itself, but never a caller-supplied storage port.
