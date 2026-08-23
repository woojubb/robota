---
title: 'SEC-018: plugin identifiers and registry paths escape the plugin root'
issue: https://github.com/woojubb/robota/issues/2020
status: in-progress
created: 2026-08-23
priority: critical
urgency: now
area: packages/agent-framework/src/plugins, packages/agent-core/src/interfaces
depends_on: []
---

# SEC-018: plugin identifiers and registry paths escape the plugin root

## Problem

Remote plugin manifests and the local registry JSON were cast to TypeScript shapes after only
`typeof data === 'object'` and `typeof data.name === 'string'`. Those values then became path
components or paths:

| value                       | source                           | sink                                                           |
| --------------------------- | -------------------------------- | -------------------------------------------------------------- |
| `manifest.name`             | remote `marketplace.json`        | `join(marketplacesDir, name)` → `renameSync`                   |
| `pluginName`, `version`     | remote manifest entry            | `join(cacheDir, …)` → write, and recursive `rmSync` on cleanup |
| relative marketplace source | remote manifest                  | `join`ed without proving containment                           |
| `record.installPath`        | `installed_plugins.json` on disk | recursive `rmSync`                                             |

A manifest named `../../escaped-market` placed a marketplace outside its root; a tampered
`installPath` deleted whatever it named.

## Decision

Two guards at the boundary, in one module, following the shape SEC-006 established in
`packages/agent-session/src/session-id.ts`:

1. **`assertSafePluginSegment`** — an allowlist regex admitting no `/`, `\` or `:`, and requiring an
   alphanumeric first character. So the value cannot introduce a separator or a drive/UNC qualifier,
   and cannot be `.` or `..`; with no separator available an embedded `..` cannot form a traversal
   component. Percent-encoded traversal and NUL are rejected because the class is an allowlist rather
   than a denylist of dangerous characters.
2. **`assertContainedPath`** — containment judged on the CANONICAL form of both sides.

**REJECT rather than sanitize**, for SEC-006's stated reason applied here: a sanitiser stripping the
traversal from `../x` yields `x`, which is a name another plugin may legitimately hold. The hostile
identifier and the benign one would then map to one directory, silently cross-linking them.

**The guard lives at the boundary, not at each `join()`.** One name reaches four sinks — the rename,
the copy, the loader and the recursive delete.

## Why canonical rather than lexical, and why the port had to grow

`<root>/link` may be a symlink to `/etc`, and `resolve(root, 'link')` still starts with `root`. A
lexical prefix test cannot see it. `IFileSystem` had no `realpathSync`, so it was added — the port's
only implementer is `NodeFileSystem` and there are zero object-literal doubles, so the addition
touches two files.

A destination that does not exist yet — a rename or clone target — has no realpath, so the nearest
existing ancestor is canonicalised and the remaining components appended. Canonicalising only existing
paths would leave every create-then-check window open, and checking after the write is checking after
the damage.

## Plan

- [x] `plugin-paths.ts`: segment guard, canonical containment, contained relative resolution.
- [x] `realpathSync` on `IFileSystem` and `NodeFileSystem`.
- [x] Guard the manifest name, the install path components, and the registry `installPath`.
- [x] Split manifest reading out of `marketplace-client.ts` by responsibility.
- [x] Guard the SECOND `installPath` sink — `uninstall()`'s single-plugin delete.
- [x] Guard the relative marketplace source, whose helper was imported and never called.
- [x] Test that each SINK uses the guard, not only that the guard works.

## What the first pass missed, and why the tests did not catch it

A review found two of the four value/sink pairs still unguarded, both of them pairs this Task's own
table already named:

- `uninstall()` passed `record.installPath` — the same untrusted value, to the same recursive `rmSync`
  — with no containment check. The marketplace-wide cleanup was guarded; the single-plugin path is a
  SECOND sink on that value and was missed.
- `resolveAndInstall()` joined the remote manifest's relative `source` without proving containment,
  and `resolveContainedRelative` sat in the import list **never called** — the intent recorded, the
  call absent.

**The suite could not have found either.** It tested `plugin-paths.ts` exhaustively — 29 cases, three
killed mutants — and proved the guard WORKS. It never asserted that each sink CALLS it. That is
ARCH-101's finding one level over: a predicate covered, its use not, so deleting the use breaks
nothing.

Fixed by driving the real installer methods: a tampered registry entry pointing outside the cache, and
a manifest whose plugin `source` is `../../../..`. Each turns exactly one test red when its guard is
removed, so the coverage is falsifiable rather than assumed. The record above said four pairs were
guarded when two were; that claim is corrected here rather than quietly amended.

**Two traps met while proving it, both worth more than the fix.**

First, the uninstall test called `installer.uninstall(...)` without awaiting it, so the assertion ran
before the deletion could happen and the test passed no matter what the code did. `no-floating-promises`
caught it at lint — after it had already been counted as a passing test.

Second, and sharper: the first mutation run reported the guard's removal as SURVIVED. The mutation had
never applied — a `perl` pattern written against the pre-formatter text stopped matching once prettier
wrapped the call across five lines. **A mutation that silently fails to apply is indistinguishable from
a mutant that survives**, and it fails in the reassuring direction: it says the code is not covered when
in fact nothing was tested. Every mutation here is now confirmed applied — by asserting the mutated
text is absent — before its result is read.

## The registry delete is refused per-entry, not per-run

A tampered `installPath` skips its removal and reports, but the entry is still dropped from the
registry — otherwise one bad record would abort the cleanup of every other plugin AND pin itself in
place, which is a denial of service written into the fix for an escape.

## Test Plan

- `sec-018-path-containment.test.ts` — 29 cases. 17 rejected identifier shapes (traversal, both
  separators, absolute, drive, UNC, NUL, percent-encoded, leading dot, leading hyphen, empty,
  non-string, over-length); genuine identifiers accepted; the field named in the error; the aliasing
  argument asserted directly.
- Containment: the root itself, a real descendant, a lexical escape, a **sibling whose name merely
  extends the root** (`/a/plugins-evil` vs `/a/plugins`), a **symlink inside the root**, and a
  **destination that does not exist yet** reached through one.
- **Three mutants killed:** segment guard neutered → **19 red**; canonical replaced by lexical
  (symlink-blind) → **2 red**; prefix compared without the separator → **1 red**; restored →
  **29 green**.
- `bundle-plugin-installer.test.ts` — two cases driving the real sinks: `uninstall()` with a tampered
  `installPath` (the victim path survives AND the registry entry is still removed) and `install()`
  against a manifest whose plugin `source` escapes the marketplace directory. Each turns exactly one
  test red when its guard is removed.
- `agent-framework` 1496 tests, `agent-command` 292 tests, `pnpm harness:scan` 141 passed / 0 failed.

## User Execution Test Scenarios

**Not applicable, and for the same reason as SEC-017.** Executing one means installing a marketplace
whose manifest is named `../../escaped-market`. On the fixed build it is refused — but demonstrating
that it WAS exploitable means running the vulnerable code, and a scenario whose negative case writes
outside the user's plugin root is not one to hand a user. The property is asserted at the boundary,
where the hostile value is observable with no filesystem mutation attempted.
