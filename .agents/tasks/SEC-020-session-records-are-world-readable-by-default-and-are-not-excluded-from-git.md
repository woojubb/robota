---
title: 'SEC-020: session records are world-readable by default and are not excluded from Git'
issue: https://github.com/woojubb/robota/issues/2021
status: in-progress
created: 2026-08-23
priority: critical
urgency: now
area: packages/agent-core, packages/agent-session, packages/agent-framework, packages/agent-cli
depends_on: []
---

# SEC-020: session records are world-readable by default and are not excluded from Git

## Problem

`~/.robota` and a project's `.robota` hold the record of everything a session did: prompts, model
output, tool results, file contents that passed through a tool, and — in `settings.json` — provider
credentials. On a shared workstation or a CI host, another local account reads them unless the mode
says otherwise, and today for the session records it does not.

**Measured under umask 022, before any change** (probe against the real classes, not a reading of
the source):

| writer                                                                                                  | directory           | file     |
| ------------------------------------------------------------------------------------------------------- | ------------------- | -------- |
| `NodeSessionStore`                                                                                      | **0755**            | **0644** |
| `NodeSessionLogSink`, directory pre-created at 0777                                                     | **0777** (retained) | 0600     |
| `~/.robota` itself (`settings-io`, `node-host-settings-store`, `host-identity`, `trusted-device-store`) | **0755**            | 0600     |

Three distinct causes, one shape:

1. **No mode is requested at all.** `NodeSessionStore.ensureDir` calls `mkdirSync(baseDir, {
recursive: true })` and `save` calls `writeFileSync(tempPath, …)` with no mode, so the umask
   decides. The temp file is renamed into place, so the final record inherits 0644.
2. **`mkdirSync(path, { mode })` does not set the mode of a directory that already exists.**
   `recursive: true` returns successfully and adopts whatever is there. This is not a hypothesis —
   `guarded-directory.ts` already documents it for the pairing rendezvous, and the measurement above
   reproduces it for the session log directory. A 0777 directory means another account can unlink and
   replace a 0600 record, and can enumerate session IDs, without ever reading a byte of one.
3. **`writeFileSync(path, data, { mode })` applies the mode only at CREATION.** An existing 0644
   record keeps 0644 forever, so a store written by an older version is never repaired by a newer
   one. Every 0600 in the table above is a mode that was right on the day the file was first written.

`robota init` adds no ignore rule, so a project-local `.robota/sessions` is committable by accident.

**The direction is backwards where it matters most.** The project-local path already writes 0600/0700
through `project-relative-writer.ts`. `NodeSessionStore` is the FALLBACK taken when project access is
`restricted` — that is, when trust could NOT be established — and it is the one with no modes at all.
The less trusted the workspace, the weaker the persistence.

## Direction

One owner-only host-filesystem primitive, in `agent-core` beside `utils/path-containment.ts` (which
already imports `node:fs`, so this is placement by ownership rather than a new precedent). Create,
`chmod` unconditionally, then `stat` and refuse — the third step is what makes the first two checkable,
and it is the only one that catches a directory someone else pre-created.

Applied at every host writer under `.robota`, plus a repair path for a file an older version left
wide. `robota init` writes `.robota/.gitignore` with targeted entries rather than touching the user's
root `.gitignore`; verified that git honours the nested file and that `settings.json` and `agents/`
stay tracked while `sessions/`, `logs/`, `checkpoints/` and `settings.local.json` do not.

Windows cannot express owner-only through `chmod`. The primitive reports which guarantee is in force
rather than asserting the POSIX one everywhere, and the limitation for a project-local `.robota`
inside a world-writable directory is recorded rather than papered over.

## Not in scope

`agent-provider-openai`'s payload logger, `dag-adapters-local` and `local-peer-registry` share cause 2
and 3 and are not session records. They are cited, not changed.

## Test Plan

30 cases, and every one sets a PERMISSIVE umask (0o022) explicitly. A case that inherits a
restrictive umask passes whether or not the mode was requested — the assertion holds either way,
which is the accidental-green shape.

`packages/agent-core/src/utils/owner-only-store.test.ts` — TC-01 to TC-16, TC-29, TC-30
: the primitive against a real filesystem: fresh create, a directory pre-created at 0777, idempotence,
missing parents, a non-directory target, a file pre-existing at 0644, no temp file left behind, a
stale temp path at 0666, tighten on a missing path, and the platform guarantee named through an
injected platform so it runs on Linux CI.

`packages/agent-session/src/__tests__/sec-020-owner-only-session-records.test.ts` — TC-15 to TC-23
: the real writers, asserting the MODE ON DISK. That is how the defect was measured in the first
place, and it is the only assertion that could have caught it: `NodeSessionLogSink` REQUESTED 0700
and got 0777, so "a mode was requested" was true of the broken code.

`packages/agent-cli/src/init/__tests__/sec-020-runtime-data-ignore.test.ts` — TC-24 to TC-28
: the ignore rules, ending with a case that asks GIT rather than reading the file back. The claim is
about what git does, and asserting the file's text proves only that the writer wrote what it was
told.

## Mutation

Each mutant was applied, `agent-core` REBUILT — the session tests resolve the primitive through the
package build, so a source mutation is invisible to them without it — and the applied-check scoped to
the code line.

| mutant                                              | agent-core red | agent-session red |
| --------------------------------------------------- | -------------- | ----------------- |
| M1 remove the unconditional directory `chmod`       | 1              | 2                 |
| M2 neuter the mode verification                     | 2              | 0                 |
| M3 remove the mode from the temp-file creation      | 4              | 4                 |
| M4 always report the Windows guarantee              | 6              | 4                 |
| M5 remove `tightenExistingFile` from the log append | 0              | 1                 |

**Two of these survived their first run, and both were defects in this work rather than in the
tests.**

M2 survived because nothing could reach the condition the verification exists for. Every case that
reached it was already caught by `mkdir` or `chmod` throwing, so deleting the check entirely changed
no result — a guard present and unproven, which is the shape issue #2181 and issue #2215 are about. Fixed by
adding the IO seams `guarded-directory.ts` already documents the need for, and TC-29/TC-30 now
exercise a filesystem that accepts `chmod` and ignores it.

M3 survived because the write set the mode at creation AND chmodded afterwards, so removing the
first changed nothing. The redundancy was also the bug: tightening after the write leaves a window in
which the whole record is on disk readable. The `chmod` is gone, the write uses `wx` so `mode`
is guaranteed to apply, and the verification proves it took.

## Not in scope, cited rather than changed

`agent-provider-openai`'s payload logger, `dag-adapters-local` and `local-peer-registry` share causes
2 and 3 above and are not session records.

## User Execution Test Scenarios

**Scenario 1 — a session record is not readable by another account.**

```
umask 022
cd "$(mktemp -d)" && git init -q .
robota init --yes
robota -p 'say hello'
ls -ld .robota/sessions && ls -l .robota/sessions/*.json
```

Expected: `drwx------` on the directory and `-rw-------` on each record. Before this change the same
two commands print `drwxr-xr-x` and `-rw-r--r--`.

**Scenario 2 — a pre-created wide directory is repaired rather than adopted.**

```
umask 022
cd "$(mktemp -d)" && git init -q .
mkdir -p .robota/logs && chmod 0777 .robota/logs
robota init --yes
robota -p 'say hello'
ls -ld .robota/logs
```

Expected: `drwx------`. Before this change it stays `drwxrwxrwx`.

**Scenario 3 — session data is not committable by accident.**

```
cd "$(mktemp -d)" && git init -q .
robota init --yes
robota -p 'say hello'
git status --porcelain
```

Expected: `.robota/settings.json`, `.robota/.gitignore` and `AGENTS.md` appear as untracked;
`.robota/sessions/` and `.robota/logs/` do not.

**Evidence:** to be captured after implementation, against the merged build.
