---
'@robota-sdk/dag-adapters-local': minor
'@robota-sdk/dag-framework': patch
---

`FileStoragePort` now enforces its single-owner contract: it claims ownership of its storage root before
any read or write, and a second live instance over the same root fails with a typed
`FileStoreOwnerConflictError` naming the holder's pid, host and acquisition time, instead of silently
losing the live owner's writes.

Ownership is held as numbered epoch files in the storage root. Each epoch is claimed only by exclusive
creation, so exactly one instance can win it, and an instance owns the root only while its epoch is the
newest. A new epoch is claimed only over one that its holder released, whose holder on the same host is
no longer running, or whose heartbeat lease has lapsed — the last covers other hosts and recreated
containers, which never run exit handlers on SIGTERM/SIGKILL. The owner renews its lease on an interval
and stops acting before its lease could look lapsed to anyone else; timing options that do not leave that
margin (a refresh interval above a third of the lease timeout) are rejected at construction.

Losing ownership — being superseded by a newer epoch or self-expiring — is permanent for that instance:
every later read and write rejects with `FileStoreOwnerConflictError`, and using the root again means
opening a new instance.

`FileStoragePort` gains `close()`, which releases ownership. Closing is final: later operations reject
with `FileStoragePortClosedError`, while work already queued before `close()` completes first.
`createDagFramework`'s `stop()` closes the file storage it created itself, never a caller-supplied storage
port. `IFileStoragePortOwnerLockOptions` is exported alongside `FileStoragePort`.
