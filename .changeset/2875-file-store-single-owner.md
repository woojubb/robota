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
unwritable directory, a stalled event loop) would otherwise leave open. Losing the lock this way, or
merely being unable to prove it was never lost, is permanent for that instance: every later read and
write rejects with `FileStoreOwnerConflictError`, and using the root again means opening a new instance,
which acquires it the ordinary way rather than resuming the old one's in-memory state. An earlier design
let an instance resume once it found nothing had actually taken over; that reset the working set out
from under already-admitted operations and could itself lose writes across the recovery boundary, so it
was removed in favor of this simpler, always-safe stop.

Reclaiming a stale lock is serialized end-to-end with token-verified destructive steps, not
check-then-remove: the guard and lock files are only ever deleted after atomically capturing whatever
currently occupies that path and confirming its content is still the exact stale instance a taker
observed, restoring it otherwise. This closes a window where a fresh guard or lock, written between a
taker's check and its unconditional removal, could be destroyed out from under its rightful holder,
letting two takers both believe they won a stale-lock takeover.

`FileStoragePort` gains a `close()` method that releases ownership; closing is final — every later
operation on that instance rejects with a typed `FileStoragePortClosedError`. Only operations invoked
after `close()` is called are rejected; anything already queued beforehand — a run/task write in flight,
or a definition write in flight — is still awaited and completes normally before `close()` returns and
releases the lock, and any in-flight acquisition is awaited too. `createDagFramework`'s `stop()` releases
the file storage owner lock it created itself, but never a caller-supplied storage port.

`IFileStoragePortOwnerLockOptions` is now exported from the package entry point alongside `FileStoragePort`.
