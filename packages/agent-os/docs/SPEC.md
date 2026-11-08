# @robota-sdk/agent-os — Package Specification

## Purpose

Node host primitives that several Robota packages need and none should re-implement: rooted file
access that a path swap cannot redirect, a nonblocking operation lock for cooperating processes, and
reliable termination of a spawned process and its descendants. Each primitive is domain-free and has
a single responsibility; this package is deliberately not a catch-all for host utilities.

The primitives share no code. They live in one package to save a manifest, a build and a release
receipt each, and they stay separate subpaths so that importing one never loads another.

## Contract

- There is no root export. A primitive is imported through its own subpath: `file-authority`
  (with `file-authority/testing`), `node-lock` or `process`.
- A subpath never imports another subpath.
- The package has no `@robota-sdk` dependency, so any package can depend on it without a cycle.
- Every subpath is Node only and maps `browser: null`.
- Koffi is an optional peer dependency, pinned exactly. Only `file-authority` and `node-lock` load it;
  a consumer of `process` installs and loads no native binding.

## file-authority

### Scope

This subpath owns domain-free file access through opaque read and write authorities rooted at one
directory identity, including root-relative directory enumeration on supported Windows drive roots. It gives Node.js callers
non-retargetable, component-by-component no-follow behavior on supported Linux, macOS, and Windows
hosts without exposing native handles.

Koffi is the pinned transport for calling the host primitives; Koffi does not define the public
contract and cannot introduce a pathname fallback.

### Boundaries

| Rule                  | Detail                                                                                                                                                |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Narrow operations     | The read authority returns bounded regular-file bytes and rooted directory observations; the write authority atomically replaces UTF-8 regular files. |
| Root-relative only    | Callers provide validated single path segments. Absolute paths, separators, `.` and `..` are rejected.                                                |
| Opaque authority      | Descriptors, Windows handles, Koffi objects, canonical roots, and ambient-path escape hatches are never exported.                                     |
| Domain-free           | Session, workspace, payload, agent, and CLI policy remain with callers.                                                                               |
| Fail closed           | An unsupported host, filesystem, primitive, or native bridge returns a typed refusal; there is no pathname fallback.                                  |
| Authorized hard links | A hard link already beneath the retained root is an authorized namespace entry. Content identity remains a consumer concern.                          |

The repository placement and allowed dependency direction are owned by the architecture map and the
package manifest rather than restated here.

### Design Decisions

- The POSIX adapter resolves components from retained directory descriptors and commits replacement relative to the retained parent, so an ambient pathname cannot retarget the operation.
- The Windows adapter resolves through `NtCreateFile` with `OBJECT_ATTRIBUTES.RootDirectory`, surfaces reparse points, and commits a temporary handle relative to the retained parent through `NtSetInformationFile`, because Win32 `SetFileInformationByHandle` rejects a bare name beside a `RootDirectory` and accepts only a full path. The writer re-opens the committed name with attribute-only access to compare identities, since its own temporary handle is still open for writing. A Windows `HANDLE` is never passed to Node as a numeric file descriptor.
- The final file handle denies write sharing for the bounded read, so an existing writer prevents the open and a new writer cannot change file bytes mid-read. Parent directory handles retain write sharing so unrelated namespace updates are not blocked.
- The authority stays bound to the directory object it originally opened even if its pathname is renamed or replaced; a retained reader can establish that another live reader, writer, or POSIX mutation descriptor holds the same root object without exposing native identities, so a restored pathname cannot make a different opened root count as the approved one. A detected root or file mutation fails the operation rather than returning indeterminate bytes.
- Per-read handles close in `finally`; `close()` and the disposal path close the root idempotently.
- No public extension points exist. Host adapters and internal test hooks are private and non-exported; adding a backend or operation is a contract change requiring specification review.

### Invariants

- `readBytes` returns `undefined` only when the requested entry does not exist. A zero-byte regular file succeeds with a budget of zero; observing any byte beyond the requested budget returns `OVER_BUDGET` rather than truncating silently.
- There is no pathname, stream, or alternate-backend fallback. A host that cannot retain, walk, and commit through native directory authority fails closed with `UNSUPPORTED_BACKEND`.
- After an authority has removed a descriptor or handle from its state, close failures may be suppressed, and Windows may fall back to `CloseHandle` if `NtClose` throws or returns a failure status — but neither path can resume or authorize a later read.
- Error messages and metadata may identify only the operation, segment index, and host code. They must not contain an absolute root, payload bytes, or caller secrets.

### Error Taxonomy

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

### User Execution Test Scenarios

Not applicable.

**Reason:** This primitive is only a calling-code primitive; the user-observable replay flow and its exact
command are owned and recorded by `@robota-sdk/agent-session`.

## node-lock

### Purpose

Coordinate cooperating Node processes while a shared local operation commits.

### Contract

An acquired guard excludes other participating holders of the same namespace until release or process exit. Acquisition does not wait.

### Invariants

The guard file remains in place while its namespace is in use. A holder releases its guard even when its operation fails.

### Non-goals

The guard does not constrain programs that do not participate, including older versions, or programs able to replace its path. Network filesystem behavior is not qualified.

### Design decisions

An operating-system handle carries the guard so process termination releases it without treating a slow live holder as abandoned.

## process

### Purpose

Domain-free child-process lifecycle primitives. It owns the one thing every process-spawning
package needs and none should re-implement: reliably terminating a spawned process and its
descendants. Cohesion comes from that single responsibility — this subpath is deliberately not a
catch-all for process utilities.

The TUI-owned PTY runner uses a different process abstraction (`node-pty`'s `IPty`) and
therefore cannot depend on this subpath's `ChildProcess`-shaped helper directly — it applies the
same escalation pattern independently rather than sharing the implementation.

### Contract

`killProcessTree(child, options)` returns a promise that resolves once the process has actually
exited, following this escalation:

1. Already-exited processes resolve immediately without signalling.
2. An optional pre-kill hook runs first (e.g. a graceful IPC `cancel` message before any signal);
   if it throws or rejects, that is swallowed and escalation still proceeds.
3. The initial signal (default `SIGTERM`) is sent to the whole process group on POSIX, requiring
   the caller to have spawned the child `detached: true` so it is a group leader. Windows has no
   graceful signal, so the whole tree is force-ended at once (`taskkill /T /F`): ending only the
   direct child would leave a shell's descendants running with its pipes open.
4. If the process has not exited after the grace window, it is force-killed (`SIGKILL` on POSIX,
   `taskkill /T /F` on Windows).
5. The promise settles on the real `exit` event — never synchronously, and never on the
   `child.killed` flag, which is misleading. This lets dependent cleanup (e.g. temp-dir removal)
   safely follow.

It never rejects for a process that will not die — SIGKILL to a process group is the terminal
action. Signalling an already-dead process (`ESRCH`) is caught and ignored. It rejects only when
given a child with no `pid` and no exit state, which is a programming error (the child was never
spawned).

### Non-goals / Boundaries

- Pure Node `child_process`/`process`, consumable from anywhere.
- No agent/AI/tool/session concepts — only OS process termination.
- Does not own spawning, stdio wiring, or timeout policy — those stay with each caller.
