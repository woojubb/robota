---
title: 'SEC-020: session records are world-readable by default and are not excluded from Git'
issue: https://github.com/woojubb/robota/issues/2021
status: done
completed: 2026-08-23
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

### Evidence — executed 2026-08-23 against the merged build

Run in a real pty with `umask 022`, in an **untrusted** workspace, so the session store is the
restricted-workspace fallback — the path review found unguarded and the one this change calls most
important. The user store directory was created BY HAND at 0755 before the run, so it is the
pre-existing-wide case rather than a fresh create.

```
$ umask
022

# created by hand before the run, under umask 022 → 0755
$ ls -ld ~/.robota
drwxr-xr-x  ~/.robota

$ robota            # one turn, then exit

$ ls -la ~/.robota
drwx------   .                    ← tightened from 0755 by the product
drwx------   sessions
-rw-r--r--   settings.json        ← written by hand, only READ this run (see gap 1)
-rw-r--r--   update-check.json    ← written by the product this run (see gap 2)

$ ls -l ~/.robota/sessions
-rw-------  27984  session_2b2d1242-….json
```

**Scenario 1 satisfied** — the record is 0600 and its directory 0700, where the same run measured
0644 and 0755 before the change.

**Scenario 2 satisfied, and by the stronger form.** The scenario as written pre-created a log
directory at 0777; what this run shows is a pre-existing **store root** at 0755 tightened to 0700 by
the product, which is the case round-1 review found and the one no other writer would have repaired
on this path.

**Scenario 3 blocked, and the blocker is recorded rather than worked around.** `robota init` refuses
with `Project initialization requires project access` in an untrusted workspace, and granting trust
is an interactive decision with no non-interactive path — correctly, since it is a security grant.
So the ignore rules cannot be exercised headlessly through the product surface. `TC-28` covers the
claim that matters by asking **git itself** what it stages after `runInitCommand`, which is the
behaviour the scenario would have observed.

### Two gaps this run found, neither a confidentiality hole

Both files sit inside a 0700 directory, so no other account can reach them; these are
defence-in-depth inconsistencies rather than exposures. Recorded because the run found them and
silence would read as their absence.

1. **`settings.json` stays 0644 when the product only READS it.** `tightenExistingFile` runs on the
   write path, so a settings file an older version left wide is repaired at its next write and not
   before. That is the documented behaviour and it is worth stating: the repair is
   write-triggered, not startup-triggered.
2. **`update-check.json` is written at 0644 by `update-check.ts`**, which was in the enumeration of
   `~/.robota` writers and was scoped out as not-a-session-record. It is not sensitive — a version
   string and a timestamp — but it is now the only file the product writes into that directory
   without an owner-only mode. Filed as issue #2229.
