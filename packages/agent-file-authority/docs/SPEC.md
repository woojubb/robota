# @robota-sdk/agent-file-authority — Package Specification

## Scope

This package owns one domain-free capability: bounded byte reads through an opaque authority rooted
at one directory identity. It gives Node.js callers the same non-retargetable, component-by-component
no-follow behavior on supported Linux, macOS, and Windows hosts without exposing native handles.

The package is published with no `@robota-sdk` dependency. Koffi is the pinned transport for
calling the host primitives; Koffi does not define the public contract and cannot introduce a
pathname fallback.

## Boundaries

| Rule                  | Detail                                                                                                                       |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Read-only             | The authority reads regular-file bytes. It does not enumerate, inspect, create, rename, or mutate entries.                   |
| Root-relative only    | Callers provide validated single path segments. Absolute paths, separators, `.` and `..` are rejected.                       |
| Opaque authority      | Descriptors, Windows handles, Koffi objects, canonical roots, and ambient-path escape hatches are never exported.            |
| Domain-free           | Session, workspace, payload, agent, and CLI policy remain with callers.                                                      |
| Fail closed           | An unsupported host, filesystem, primitive, or native bridge returns a typed refusal; there is no pathname fallback.         |
| Authorized hard links | A hard link already beneath the retained root is an authorized namespace entry. Content identity remains a consumer concern. |

The repository placement and allowed dependency direction are owned by the architecture map and the
package manifest rather than restated here.

## Design Decisions

- The POSIX adapter calls real `openat` with `O_NOFOLLOW` for every path component, so a symlink anywhere in the walk is refused rather than silently followed.
- The Windows adapter opens files via `NtCreateFile` with `OBJECT_ATTRIBUTES.RootDirectory` (bounding resolution to the retained root handle) and `FILE_OPEN_REPARSE_POINT` (so reparse points are surfaced rather than transparently traversed), and verifies attributes on each resulting native handle. A Windows `HANDLE` is never passed to Node as a numeric file descriptor, to keep the authority opaque.
- The final file handle denies write sharing for the bounded read, so an existing writer prevents the open and a new writer cannot change file bytes mid-read. Parent directory handles retain write sharing so unrelated namespace updates are not blocked.
- The authority stays bound to the identity it originally opened even if that pathname is later renamed or replaced elsewhere in the namespace, and it re-checks root/file identity around each operation; a detected mutation fails the read rather than returning bytes from an indeterminate state.
- Per-read handles close in `finally`; `close()` and the disposal path close the root idempotently.
- No public extension points exist. Host adapters and internal test hooks are private and non-exported; adding a backend or a public operation is a contract change requiring specification review.

## Invariants

- `readBytes` returns `undefined` only when the requested entry does not exist. A zero-byte regular file succeeds with a budget of zero; observing any byte beyond the requested budget returns `OVER_BUDGET` rather than truncating silently.
- There is no pathname, stream, or alternate-backend fallback for reads. A host that cannot retain and walk native directory authority fails closed with `UNSUPPORTED_BACKEND`.
- After an authority has removed a descriptor or handle from its state, close failures may be suppressed, and Windows may fall back to `CloseHandle` if `NtClose` throws or returns a failure status — but neither path can resume or authorize a later read.
- Error messages and metadata may identify only the operation, segment index, and host code. They must not contain an absolute root, payload bytes, or caller secrets.

## Error Taxonomy

| Code                  | Category                                                                                | Recoverable |
| --------------------- | --------------------------------------------------------------------------------------- | ----------- |
| `INVALID_PATH`        | Caller supplied an invalid root, segment list, or byte budget                           | yes         |
| `UNSAFE_ENTRY`        | A link, reparse point, non-directory parent, or non-regular final entry was encountered | yes         |
| `UNSUPPORTED_BACKEND` | The host/architecture/filesystem cannot uphold this contract                            | no          |
| `AUTHORITY_CLOSED`    | The caller used an authority after closing it                                           | no          |
| `ROOT_CHANGED`        | The retained root identity became inconsistent                                          | no          |
| `FILE_CHANGED`        | File identity, size, or metadata changed during the bounded read                        | yes         |
| `OVER_BUDGET`         | The regular file contains more bytes than allowed                                       | yes         |
| `HOST_IO`             | Another host I/O failure prevented a trustworthy result                                 | maybe       |

## User Execution Test Scenarios

Not applicable.

**Reason:** This leaf is only a calling-code primitive; the user-observable replay flow and its exact
command are owned and recorded by `@robota-sdk/agent-session`.
