---
title: 'TRANS-010: the transport settings view carries the framework settings I/O the registry shed'
issue: https://github.com/woojubb/robota/issues/2050
status: skipped
completed: 2026-08-29
returned_to_issue: https://github.com/woojubb/robota/issues/2480#issuecomment-5460392479
created: 2026-08-25
priority: medium
urgency: later
area: packages/agent-transport, packages/agent-framework
depends_on: [TRANS-009]
---

# TRANS-010: the registry's filesystem dependency moved one file over

## Resolution

Returned to implementation follow-up issue #2480 on 2026-08-29. The dependency-injection seam is
still unresolved and requires source/API work; this document-only migration makes no implementation
change.

## Problem

Issue #2050 says `TransportRegistry` combines lifecycle, persistence and projection, and that its core
cannot be tested without a filesystem import. The split has since happened. **The dependency did not
go away — it travelled with the seam.**

## Evidence

Measured at `e5551e9b6`. `packages/agent-transport` has moved 394 lines since issue #2050's pinned
revision `15800bf0`; `transport-registry.ts` went 299 → 270 lines and two files appeared.

`transport-registry.ts` no longer imports concrete settings I/O at all — its imports are local
(`./transport-registry-errors.js`, `./transport-run-generation.js`, `./transport-settings-view.js`)
plus type-only imports. That half of the issue's claim is answered.

`transport-settings-view.ts:13`:

```ts
import { readSettings, writeSettings, type TSettingsData } from '@robota-sdk/agent-framework';
```

**That is the import the issue objects to, one file over.** Issue #2050's first acceptance criterion —
_registry core tests run with an in-memory settings repository and no filesystem import_ — is still
unmet, but for a different reason than the issue gives: the registry's shape is no longer the
problem, the dependency's location is.

## Why the seam was cut where it was

`transport-settings-view.ts`'s own header says so:

> They were one 299-line file, one line under the anti-monolith limit, so the next addition had to
> split something. This is the seam that was already there rather than a cut made to fit.

The seam was real and the split was the right one. **What it did not do was change what is on either
side of it.** A cut made to satisfy a line count relocates whatever was on the wrong side; deciding
that a dependency should be injected is a separate decision, and it was not the one being made.

## Direction

Inject an `ITransportSettingsRepository` — issue #2050's own proposal — implemented by the
shell/framework adapter, so `agent-transport` names a port and `agent-framework` supplies the file
implementation. The registry core and the settings view then both test against an in-memory
implementation.

Sequenced after TRANS-009 deliberately: TRANS-009 may change what the persistence call has to
return (a typed result the caller can render), and that shape belongs in the port. Doing the
injection first would let a testability constraint fix the signature before the correctness fix knows
what it needs.

## Test Plan

- Registry core tests and settings-view tests construct with an in-memory repository and the package's
  production source imports no filesystem API. The assertion is on the **import graph**, not on
  whether a test happened to avoid touching disk — a test that writes to a temp directory passes the
  weaker version while the dependency is still there.
- Positive control: the framework-backed implementation still reads and writes real settings, so a
  suite proving the port is honoured cannot pass against a package that has no persistence at all.
- `pnpm harness:scan` green.

## Related

`TRANS-002`'s evidence cites `transport-registry.ts:84-94` for `startAll`; at `e5551e9b6` those lines
are `replace()` and `startAll` is at `:134`. **The split described above is what moved them.** The
change was correct, the record was correct when written, and the citation died between them with no
event either side would notice — a third route to a stale citation, after a record declared and never
created (issue #2049) and a file drifting under a citation over time (CLI-080).

Refresh TRANS-002's line references as part of whichever item next edits this file, rather than as its
own change.

## User Execution Test Scenarios

Not authorable, and left unwritten with the reason recorded rather than filled with a placeholder.
This item delivers no user-facing behaviour: it relocates a dependency behind a port so the same
behaviour becomes testable without a filesystem. A user running the CLI before and after sees
identical output, which is the acceptance criterion rather than a gap in it.

**This reason does not expire.** Unlike a disposition that is merely undecided, it is a property of
what the item delivers, and it stays true however the port is shaped. If a later revision of this
item changes user-visible behaviour, that revision needs scenarios and this paragraph no longer
applies to it.
