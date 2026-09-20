# @robota-sdk/agent-file-authority — Package Specification

## Scope

This package owns one domain-free capability: bounded byte reads through an opaque authority rooted
at one directory identity. It gives Node.js callers the same non-retargetable, component-by-component
no-follow behavior on supported Linux, macOS, and Windows hosts without exposing native handles.

The package is published with no `@robota-sdk` dependency. Koffi 3.3.1 is the pinned transport for
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

## Architecture Overview

`createStableRootedFileReader(rootDirectory)` opens and retains one root authority. Each
`readBytes(relativeSegments, maxBytes)` operation validates all input before host I/O, walks one
component at a time relative to retained directory handles, refuses links/reparse points and
non-regular final entries, reads within the mandatory budget, and verifies stable file metadata
before returning bytes. Per-read handles close in `finally`; `close()` and `[Symbol.dispose]()` close
the root idempotently.

The POSIX adapter calls real `openat` with `O_NOFOLLOW` for every component. The Windows adapter
calls `NtCreateFile` with `OBJECT_ATTRIBUTES.RootDirectory` and `FILE_OPEN_REPARSE_POINT`, verifies
attributes on each resulting native handle, and uses native handle read/metadata/close operations.
A Windows `HANDLE` is never passed to Node as a numeric file descriptor.

The authority remains rooted at the opened identity if its original pathname is renamed or replaced.
It also compares root and file identity snapshots around operations. A detected mutation fails rather
than returning bytes from an indeterminate state.

## Type Ownership

| Type                            | Location                           | Purpose                                                          |
| ------------------------------- | ---------------------------------- | ---------------------------------------------------------------- |
| `IStableRootedFileReader`       | `src/contracts.ts`                 | Opaque bounded-read authority contract                           |
| `TStableFileAuthorityErrorCode` | `src/contracts.ts`                 | Exhaustive stable failure codes                                  |
| `StableFileAuthorityError`      | `src/contracts.ts`                 | Safe typed error without absolute paths or content               |
| `IFileAuthorityTestHooks`       | `src/stable-rooted-file-reader.ts` | Internal deterministic race hooks, absent from the public barrel |

## Public API Surface

| Export                          | Kind      | Description                                                                                                                            |
| ------------------------------- | --------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `createStableRootedFileReader`  | function  | Open an identity-bound root and return its opaque read authority                                                                       |
| `IStableRootedFileReader`       | interface | `readBytes`, idempotent `close`, and `[Symbol.dispose]`                                                                                |
| `StableFileAuthorityError`      | class     | Typed failure with a stable code and safe operation context                                                                            |
| `TStableFileAuthorityErrorCode` | type      | `INVALID_PATH`, `UNSAFE_ENTRY`, `UNSUPPORTED_BACKEND`, `AUTHORITY_CLOSED`, `ROOT_CHANGED`, `FILE_CHANGED`, `OVER_BUDGET`, or `HOST_IO` |

`readBytes` returns `undefined` only when a requested entry does not exist. A zero-byte regular file
succeeds with a budget of zero; observing any byte beyond the budget returns `OVER_BUDGET`.

## Extension Points

None. Host adapters and deterministic test hooks are private implementation details. Adding a backend
or a public operation changes this contract and requires specification review.

## Error Taxonomy

| Error                      | Code                  | Category                                                                                | Recoverable |
| -------------------------- | --------------------- | --------------------------------------------------------------------------------------- | ----------- |
| `StableFileAuthorityError` | `INVALID_PATH`        | Caller supplied an invalid root, segment list, or byte budget                           | yes         |
| `StableFileAuthorityError` | `UNSAFE_ENTRY`        | A link, reparse point, non-directory parent, or non-regular final entry was encountered | yes         |
| `StableFileAuthorityError` | `UNSUPPORTED_BACKEND` | The host/architecture/filesystem cannot uphold this contract                            | no          |
| `StableFileAuthorityError` | `AUTHORITY_CLOSED`    | The caller used an authority after closing it                                           | no          |
| `StableFileAuthorityError` | `ROOT_CHANGED`        | The retained root identity became inconsistent                                          | no          |
| `StableFileAuthorityError` | `FILE_CHANGED`        | File identity, size, or metadata changed during the bounded read                        | yes         |
| `StableFileAuthorityError` | `OVER_BUDGET`         | The regular file contains more bytes than allowed                                       | yes         |
| `StableFileAuthorityError` | `HOST_IO`             | Another host I/O failure prevented a trustworthy result                                 | maybe       |

Error messages and metadata may identify only the operation, segment index, and host code. They must
not contain an absolute root, payload bytes, or caller secrets.

## Test Strategy

Native-host tests run on Linux x64/arm64, macOS x64/arm64, and Windows x64. They cover successful and
missing reads, lexical rejection, parent and final link/reparse refusal, held-root and held-parent
replacement, non-regular entries, exact/zero/exceeded budgets, deterministic concurrent growth,
root/file identity checks, safe diagnostics, idempotent close, and use after close. A standalone
qualification script runs the built public surface on Node 20.19 and Node 22 and is also embedded and
executed through each native Bun artifact without external `node_modules`.

## User Execution Test Scenarios

Not applicable.

**Reason:** This leaf is only a calling-code primitive; the user-observable replay flow and its exact
command are owned and recorded by `@robota-sdk/agent-session`.

## Class Contract Registry

| Class                      | Implements/Extends | Defined In         |
| -------------------------- | ------------------ | ------------------ |
| `StableFileAuthorityError` | `Error`            | `src/contracts.ts` |

The concrete authority and host adapters are intentionally non-exported implementation classes.
