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
a fast path, without waiting out the full lease.

Every acquisition attempt — not only a stale-lock takeover, but also the fast path where no lock exists
yet — is serialized end-to-end by a short-lived takeover guard, so concurrent acquirers cannot both
believe they won. Every destructive step (removing a stale lock, reclaiming an abandoned guard,
releasing a lock or a guard, including on process exit) is token-verified rather than check-then-act: it
atomically captures whatever currently occupies the path before checking its content, and restores it
if that content does not match what was expected, so a lock or guard freshly written by someone else can
never be destroyed out from under its rightful holder. The takeover guard's own staleness is judged on a
short, fixed threshold sized for how long one guarded attempt should plausibly take (never the full lease
timeout, which could otherwise wedge every `acquire()` on the root for as long as that timeout once
abandoned), and `acquire()` retries a contested guard with a bounded, gently backed-off wait rather than
a small fixed number of immediate attempts, so it reliably waits out that short threshold instead of
giving up early with a misleading "contested" error.

An owner whose lease is reclaimed out from under it during a long stall notices on its next renewal
and stops accepting further reads and writes, rather than continuing unaware as a second,
unaccounted-for owner. It also stops itself proactively: it tracks its own last successful renewal and
refuses further reads and writes once that is old enough that another opener could legitimately treat
its lease as expired, closing the lost-update window a heartbeat that keeps failing to write (an
unwritable directory, a stalled event loop) would otherwise leave open. Losing the lock this way, or
merely being unable to prove it was never lost, is permanent for that instance: every later read and
write rejects with `FileStoreOwnerConflictError`, and using the root again means opening a new instance,
which acquires it the ordinary way rather than resuming the old one's in-memory state.

`FileStoragePort` gains a `close()` method that releases ownership; closing is final — every later
operation on that instance rejects with a typed `FileStoragePortClosedError`. Only operations invoked
after `close()` is called are rejected; anything already queued beforehand — a run/task write in flight,
or a definition write in flight — is still awaited and completes normally before `close()` returns and
releases the lock, and any in-flight acquisition is awaited too. `createDagFramework`'s `stop()` releases
the file storage owner lock it created itself, but never a caller-supplied storage port.

`IFileStoragePortOwnerLockOptions` is now exported from the package entry point alongside `FileStoragePort`.
