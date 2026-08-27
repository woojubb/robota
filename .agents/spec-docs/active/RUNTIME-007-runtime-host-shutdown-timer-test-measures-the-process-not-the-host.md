---
status: in-progress
type: BEHAVIOR
tags: [testing, async]
---

# RUNTIME-007: runtime-host's shutdown timer test measures the process, not the host

## Problem

`packages/agent-framework/src/runtime/__tests__/runtime-host.test.ts:102-106` asserts, for the
issue #1852 fix, that `host.shutdown()` leaves no timer holding the event loop open — and measures it as

```ts
const before = process.getActiveResourcesInfo().filter((r) => r === 'Timeout').length;
await host.shutdown();
const after = process.getActiveResourcesInfo().filter((r) => r === 'Timeout').length;
expect(after).toBeLessThanOrEqual(before);
```

That quantity is process-wide. Re-measured on `develop` `bb4c3626e` (2026-08-28 00:08 KST):

```
real HOME  (~/.claude/settings.json has 1 SessionStart hook)   → expected 3 to be less than or equal to 2   1 failed | 4 passed   exit 1
empty HOME (mktemp -d)                                          → 5 passed                                     exit 0
```

Only `HOME` differed. An `async_hooks` probe attributing each `Timeout` to its creation site shows
the surviving timer is the per-command timeout at
`packages/agent-core/src/hooks/executors/command-executor.ts:106`, armed for the developer's
SessionStart hook, which the session fires from its constructor (`packages/agent-session/src/session.ts:158`)
after reading `~/.claude/settings.json` through
`createDefaultUserSettingsSources()`'s `process.env.HOME` default
(`packages/agent-framework/src/config/settings-source.ts:37-38`), called with no argument from
`interactive-session-project-context.ts:41` and `interactive-session-provider-switch.ts:17`.

**Reproduction condition.** Any run of this file on a machine whose `~/.claude/settings.json` or
`~/.robota/settings.json` defines a SessionStart command hook; and, independently of the machine, any
vitest timer arming or expiring inside the ~10 ms shutdown window, which the count cannot
distinguish from the host's own timers. The issue's mechanism paragraph attributes the extra timer to
"timers vitest and other in-flight work own"; measured, it is the session's own hook timeout, sourced
from the machine — the headline holds, the attribution does not.

## Prior Art Research

Waived: the two remedies are the repository's own. Measuring the host's timers by identity rather
than by a process-wide count is `measurement-provenance.md`'s rule that an instrument must measure
the thing the claim names; isolating the user home in a test is what PR #2296 did for the first
instance of this class (issue #2300, `userHome` = an empty temp directory). Node's own
documentation for `async_hooks` (`init`/`destroy` carry the resource and its id) and
`timeout.hasRef()` is the mechanism, not a citation that changes the decision.

## User Execution Test Scenarios

**Author verdict:** `SCENARIO DRAFTED: not-applicable | 0`

A user-execution scenario is **not applicable**. One test file's measurement and its environment
isolation change; no CLI command, TUI surface, published API or runtime behaviour changes, so there
is no product command whose output differs. The verification surface is the package test run and the
recorded mutation.

## Depth verdict and containment

`finding-depth-triager` (2026-08-27) returned three verdicts on this problem statement, and the
paired Task records them. The one that binds this document: the red is **FOUNDATIONAL** — the
framework's session initialisation reads the real user home with no seam and the harness isolates
nothing, a class issue #2300 filed from its first instance (PR #2296) without a Task record. The root
item is **TEST-012**
(`.agents/tasks/TEST-012-framework-session-init-reads-the-real-user-home-with-no-seam.md`,
registered as issue #2300). This document isolates `HOME` in one file as a **labelled containment**
under `finding-depth.md`'s three conditions: the smallest change that makes this test's red mean the
host leaked a timer; no new abstraction; `// Contained — TEST-012.` at the isolation site and the ID
in the commit body. The measurement half is LOCAL and is fixed here outright.

**Sequencing the root record.** As with HARNESS-128 on HARNESS-127: the TEST-012 file is held outside
the tree from the first planning prelude commit through the GATE-IMPLEMENT checkpoint
(`user-execution-plan-order` refuses any other path in either) and lands in the implementation commit
that carries the label, where the code-label floor (`depth-verdict-reachable.test.mjs`, reading
`git ls-files`) resolves it.

## Architecture Review

### Affected Scope

- `packages/agent-framework/src/runtime/__tests__/runtime-host.test.ts` — the measurement, the
  per-test home isolation, and one control case
- No production path in `packages/`, no rule or catalogue text

### Alternatives Considered

**A1 — Isolate `HOME` only; keep the process-wide count.** One `beforeEach`.

- Pro: turns this machine's red green with three lines.
- Con: the instrument stays wrong. A vitest timer expiring inside the shutdown window still reads as
  green for the wrong reason, and an unrelated timer arming reads as red — the issue's second
  half, and the reason the test's own comment rejected elapsed time.

**A2 — Identity measurement plus per-test home isolation, labelled (chosen).** An `async_hooks`
hook records every `Timeout` resource created from the `startRuntimeHost` call until `shutdown()`
resolves; the assertion is that none of those is still alive with `hasRef()`. `HOME` and
`USERPROFILE` point at a fresh empty directory for each test and are restored after, under
`// Contained — TEST-012.`. One control asserts the isolation reaches
`createDefaultUserSettingsSources()`.

- Pro: red means "a timer armed during the host's lifetime — by the host or the session it built —
  and left ref'd after `shutdown()`", which is why the home isolation is a condition of the
  assertion's meaning rather than a separate nicety. Reproduced under the mutant that drops
  `clearTimeout(bound)` (the issue #1852 regression): one leaked timer naming `runtime-host.ts:96`;
  restored, zero. The file passes under a decoy home carrying a SessionStart hook and under an empty
  one; the class stays visible through the label rather than through a comment.
- Con: `async_hooks` is a low-level API and the recording window must bracket exactly the host's
  lifetime; a timer the host arms and legitimately `unref()`s is accepted (by design — it does not
  hold the loop). The other session-constructing test files keep the default — the population is
  28–35 files by constructor/factory grep, and the exposed subset — those that neither inject a
  session, mock initialisation, pass `config:`, nor set `HOME` — did not reproduce as a stable count
  across heuristics (1 to 14), so its size is TEST-012's to settle, not this document's.

**A3 — Global `HOME` isolation in a vitest setup file.** Remedy (1) of issue #2300.

- Pro: closes the class in one place.
- Con: it is the class remedy, unchosen in issue #2300, with a blast radius of every test in every package
  (28–35 files construct a session; others may read the real home on purpose) and a decision to
  record. Taking it inside a `blocks-landing` one-file fix is scope the depth verdict routed
  elsewhere. Stays TEST-012's.

**A4 — A `userHome` seam on the session's option surface.** Thread what the CLI already threads
(`workspace-project-composition.ts:70,130`) into `InteractiveSession`.

- Pro: the right long-term shape; tests would pass a temp home explicitly.
- Con: a construction-surface change while issue #2063 → issue #2084/#2115 (SessionRecipe kernel) is moving
  exactly that surface; a fourth ad-hoc parameter now is what the kernel exists to remove. TEST-012,
  sequenced with those.

### Decision

**A2, as a labelled containment under TEST-012.** A1 is rejected because it fixes the machine and
not the instrument; A3 and A4 are the class remedies and belong to the root item. What this change
must leave true: a red in this test names a timer the host armed and did not cancel, on any machine.

### Architecture Review Checklist

- [x] Affected package/layer list complete — one test file in `packages/agent-framework`, no
      production path
- [x] Sibling scan complete — `N/A for new-surface placement`: no package, app, presentation or
      interface surface. Sibling tests checked: `getActiveResourcesInfo` occurs in exactly this one
      file in the repository (`git grep -l getActiveResourcesInfo -- packages`); the other
      session-constructing test files are TEST-012's population, not this change's.
- [x] At least 2 alternatives reviewed — A1–A4
- [x] Decision rationale documented — A1 fixes the machine, not the instrument; A3/A4 are the root
      item's remedies

## Fallback & Degradation Declaration

None. A test's measurement and environment change; no runtime path degrades and nothing falls back.

## Solution

In `runtime-host.test.ts`:

1. `beforeEach` creates a fresh empty home under `tmpdir()`, saves `process.env.HOME` and
   `process.env.USERPROFILE`, and points both at it; `afterEach` restores them and removes the
   directory. The block opens with `// Contained — TEST-012.` and one sentence on why.
2. The issue #1852 case brackets the host's lifetime with an `async_hooks` hook enabled **before**
   `startRuntimeHost`. Two collections, because they answer two questions: `seen` records every
   `Timeout` `init` (id → resource and creation stack) and is never shrunk; `destroyed` collects the
   ids `destroy` reports. After `await host.shutdown()` the test yields **one macrotask**
   (`await new Promise(setImmediate)`) before disabling the hook and reading — measured on Node
   22.14: `clearTimeout` leaves `hasRef()` true and `destroy` fires on the next check-phase turn, so
   reading synchronously reports the correctly cancelled bound as leaked, on correct and mutant code
   alike. Two assertions: `seen.size >= 1` (the instrument saw the bound; on correct code under
   isolation every `seen` entry is destroyed and the bound is among them — a first-in-worker host
   also sees vitest's unref'd `fetchModule` RPC timeout, destroyed before the import resolves — and
   an empty `seen` is "could not check", not a pass), and no
   entry of `seen` is absent from `destroyed` with `hasRef() === true`; the failure message carries
   the survivors' count and creation stacks. Unref'd timers are accepted by design — the claim is
   loop-holding (the issue #1852 title) — and the comment says so, noting that a
   `clearTimeout → unref()` regression in the host would pass this test.
3. One control case asserts `createDefaultUserSettingsSources()` **and** `homedir()` resolve under
   the isolated home during a test and — after restoring the saved env in the same case — under the
   saved home. `homedir()` is load-bearing, not optional: `process.env.HOME` reaches `os.homedir()`
   only in a forked worker (`vitest.shared.ts` sets `pool: 'forks'`; measured: a `worker_thread`
   returns the real home), and the framework's home readers that call `homedir()` — nine sites under
   `packages/agent-framework/src`, among them `initial-contribution-sources.ts:12,20` and
   `interactive-session-init.ts:91` — all depend on that. The
   control's comment says this, so a future pool change breaks the isolation loudly.

## Affected Files

| File                                                                  | Change                                                        |
| --------------------------------------------------------------------- | ------------------------------------------------------------- |
| `packages/agent-framework/src/runtime/__tests__/runtime-host.test.ts` | measurement by identity; per-test home isolation; one control |

## Completion Criteria

- [ ] **TC-01** The issue #1852 case asserts on the set of `Timeout` resources the host armed (tracked by
      identity from `startRuntimeHost` through `shutdown()`), not on a process-wide count, and passes
      on the committed tree.
- [ ] **TC-02** Under the mutant that deletes `if (bound !== undefined) clearTimeout(bound);` in
      `packages/agent-framework/src/runtime/runtime-host.ts`, TC-01 fails naming one ref'd timer;
      restored, it passes; `git diff --stat` empty after restore. Recorded with output.
- [ ] **TC-03** The file passes under a **decoy home** — a temp directory whose
      `.claude/settings.json` plants one SessionStart command hook in the accepted shape
      (`{ matcher: '', hooks: [{ type: 'command', command, timeout }] }`) — and under an empty home,
      both via `HOME=… USERPROFILE=…` at the command line; both runs recorded with the decoy's
      preparation command and exit codes. The decoy reproduces this machine's real-home red on the
      unfixed test (recorded), so the evidence is reproducible anywhere.
- [ ] **TC-04** The control case: `createDefaultUserSettingsSources()` and `homedir()` both resolve
      under the isolated home during the test and under the saved home after restore.
- [ ] **TC-05** `pnpm --filter @robota-sdk/agent-framework exec vitest run` passes for the package
      (count recorded), and `pnpm harness:scan` exits 0 on the branch.

## Test Plan

| TC-ID | Test Type   | Tool / Approach                                                                                                        | Notes                                                                    |
| ----- | ----------- | ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| TC-01 | Integration | vitest, `async_hooks` identity tracking around `startRuntimeHost` → `shutdown()`                                       |                                                                          |
| TC-02 | Mutation    | delete the `clearTimeout(bound)` line in `runtime-host.ts`, run the file, restore, record                              | hand-run; `git diff --stat` empty after restore                          |
| TC-03 | Integration | the file under `HOME=<decoy with a planted SessionStart hook>` and under `HOME=$(mktemp -d)/home`, exit codes recorded | the decoy is prepared by a recorded command; reproducible on any machine |
| TC-04 | Integration | vitest control case calling `createDefaultUserSettingsSources()` and `homedir()` inside and after the isolation        |                                                                          |
| TC-05 | Integration | `pnpm --filter @robota-sdk/agent-framework exec vitest run` and `pnpm harness:scan`, exit codes                        |                                                                          |

## Tasks

- [ ] `.agents/tasks/RUNTIME-007-runtime-host-shutdown-timer-test-measures-the-process-not-the-host.md` — 생성됨 (GATE-IMPLEMENT에서 바인딩)

## Evidence Log

### [GATE-WRITE] — ✅ PASS | 2026-08-28

**Status upgrade:** draft → review-ready

- Ordering: GATE-WRITE is the entry gate (no prior gate). Document is `status: draft` under `.agents/spec-docs/draft/` — matches `spec-workflow.md` § Spec-Document Status and Lifecycle Folders. Evidence Log was empty before this entry.
- Frontmatter: file begins with `---` at line 1; `status: draft`; `type: BEHAVIOR` (one of the 11 prefixes); `tags: [testing, async]` present.
- Problem — symptom: the quoted `before` / `shutdown()` / `after` / `expect` block is verbatim in `runtime-host.test.ts` at lines 102–106 (the document cites `:103-108` — off by one at the start and two at the end; the code is exact). Re-run on branch `fix/2383-runtime-host-test-measures-the-host` = `develop` `bb4c3626e`: real `HOME` → `expected 3 to be less than or equal to 2`, `Tests 1 failed | 4 passed (5)`, exit 1; `HOME=USERPROFILE=$(mktemp -d)/home` → `Tests 5 passed (5)`, exit 0. `~/.claude/settings.json` hooks = `{SessionStart: 1}`.
- Problem — cited mechanism verified line-for-line: `command-executor.ts:106` is `const timer = setTimeout(`; `session.ts:158` is `fireSessionStartHook(` in the constructor; `settings-source.ts:37-38` is `userHome: string = process.env.HOME ?? process.env.USERPROFILE ?? '/'`; `interactive-session-project-context.ts:41` and `interactive-session-provider-switch.ts:17` both call `createDefaultUserSettingsSources()` with no argument; `runtime-host.ts:99` holds `if (bound !== undefined) clearTimeout(bound);` (the TC-02 mutant line). Issue #2383 OPEN, issue #1852 CLOSED, issue #2300 OPEN, PR #2296 MERGED — titles match the roles the document assigns them.
- Problem — reproduction condition: explicit paragraph (any machine whose `~/.claude/settings.json` or `~/.robota/settings.json` defines a SessionStart command hook; independently of the machine, any vitest timer arming or expiring inside the shutdown window).
- Problem — no "TBD" / "TODO" anywhere in the document (grep clean); multi-paragraph with re-measured figures, not a single vague sentence.
- Prior Art Research: section present; `Waived: <reason>` line present. Reason verified: `.agents/rules/measurement-provenance.md` exists; PR #2296 is merged and issue #2300 is the class it filed. `scan-spec-research.mjs` passes over the tree (25 examined, exit 0).
- Research feeds Alternatives/Decision: the waiver's two anchors are A2's two halves (measure by identity = measurement-provenance; per-test home isolation = the PR #2296 `userHome` precedent); A3 and A4 are rejected by reference to issue #2300's unchosen class remedy and the issue #2063 → issue #2084/#2115 sequencing — evidence-based, not asserted.
- Architecture Review Checklist: all 4 items `[x]`.
- Sibling scan: `[x]` with `N/A for new-surface placement` plus completion evidence; verified — `git grep -l getActiveResourcesInfo -- packages` returns exactly 1 file (`runtime-host.test.ts`; 3 occurrences at lines 94, 102, 104).
- Alternatives Considered: A1, A2, A3, A4 — each with a Pro and a Con.
- Decision: names the deciding trade-off — A1 fixes the machine and not the instrument; A3/A4 are the root item's class remedies, outside a one-file `blocks-landing` scope.
- New-surface placement: N/A — one existing test file changes; no package, app, presentation/interface surface or layer reclassification.
- Completion Criteria: TC-01…TC-05, every item prefixed; TC-01 identity measurement, TC-02 mutation proof, TC-03 both-homes run (6/6 = 5 existing + 1 control), TC-04 isolation control, TC-05 package suite + `harness:scan`; each a command or an observable; grep for "works correctly / no errors / implemented / displays correctly" returns nothing.
- Test Plan: section present; rows TC-01…TC-05 = 5, matching 5 Completion Criteria; every row has a non-empty Test Type and Tool/Approach, no "TBD"; no row uses Tool "manual" — the manual-Notes requirement is N/A (TC-02's hand-run row carries a Notes entry regardless).
- Structure — Tasks: section present with one unchecked placeholder row naming the exact path, to be bound at GATE-IMPLEMENT. Evidence Log: present and empty before this entry (first run). No `## Status` / `## Classification` body sections.
- Worktree observation (not a GATE-WRITE criterion): only this spec and the untracked paired task file `.agents/tasks/RUNTIME-007-….md` differ from `develop`; `packages/` unmodified — no implementation has begun. The root record `TEST-012` is absent from the tree by the document's own stated sequencing and was not judged here.

### [GATE-WRITE] — ✅ PASS | 2026-08-28

**Status upgrade:** review-ready → review-ready (second run, after the `proposal-reviewer` revision of the Problem's line citation, A2's Pro, § Solution step 2, TC-03, TC-04, the Test Plan rows and the issue/PR reference qualification; no transition — the document already holds the status this gate's PASS maps to, and the dispatcher directed that it not change)

- Ordering: GATE-WRITE is the entry gate — exempt from the prior-gate check. Input state coherent: `status: review-ready` in `.agents/spec-docs/backlog/` (`scan-doc-folder-status-agreement.mjs` → violations=0). Evidence Log holds exactly one prior entry, `[GATE-WRITE] — ✅ PASS | 2026-08-28`, with per-criterion lines (not a bare PASS); no later gate has run, so re-running GATE-WRITE over the revised text is in order (the ARCH-019 NON-COMPLIANCE precedent — status and folder disagreeing, evidence covering a superseded version — does not apply here; the HARNESS-127 second/third-run precedent does).
- Frontmatter — `---` block: present at line 1.
- Frontmatter — `status: draft`: literally unmet — the field reads `status: review-ready`. Judged N/A on this re-run: `spec-workflow.md` § Spec-Document Status and Lifecycle Folders maps `review-ready` to exactly "GATE-WRITE passed, awaiting approval", which is this document's recorded history; the catalogue defines no `review-ready → draft` rewind; `scan-user-execution-plan-order.mjs` parses only GATE-IMPLEMENT and stage-one `Status upgrade:` lines (`:432`, `:764`), not GATE-WRITE's. The criterion's substance — the write step was not skipped — is carried by the prior specific entry.
- Frontmatter — `type: BEHAVIOR`: one of the 11 prefixes. `tags: [testing, async]`: present.
- Problem — symptom: the quoted block is verbatim at `runtime-host.test.ts:102-106` (102 `before`, 103 `shutdown()`, 104 `after`, 106 `expect`) — the revised citation is exact. Re-run on this branch (= `develop` `bb4c3626e`): real `HOME` (`~/.claude/settings.json` hooks `{SessionStart: 1}`) → `expected 3 to be less than or equal to 2`, `Tests 1 failed | 4 passed (5)`; `HOME=USERPROFILE=<empty dir>` → `Tests 5 passed (5)`. Matches the document's figures.
- Problem — cited mechanism re-verified: `command-executor.ts:106` `const timer = setTimeout(`; `session.ts:158` `fireSessionStartHook(`; `settings-source.ts:37-38` `userHome: string = process.env.HOME ?? process.env.USERPROFILE ?? '/'`; `settings-source.ts:41-42` read `<home>/.robota/settings.json` and `<home>/.claude/settings.json`; `interactive-session-project-context.ts:41` and `interactive-session-provider-switch.ts:17` call `createDefaultUserSettingsSources()` with no argument; `runtime-host.ts:96` is `bound = setTimeout(resolve, RUNTIME_SHUTDOWN_TIMEOUT_MS)` (A2 Pro's named leak site) and `:99` is `if (bound !== undefined) clearTimeout(bound);` (the TC-02 mutant line).
- Problem — reproduction condition: explicit paragraph (any machine whose `~/.claude/settings.json` or `~/.robota/settings.json` defines a SessionStart command hook; independently, any vitest timer arming or expiring inside the shutdown window).
- Problem — no "TBD" / "TODO" in the body (the only grep hits are the prior evidence entry quoting the words); multi-paragraph with re-measured figures.
- Prior Art Research: section present; `Waived: <reason>` line present. Reason verified: `.agents/rules/measurement-provenance.md` exists; PR #2296 MERGED; issue #2300 OPEN and is the class it filed. `scan-spec-research.mjs` passes over the tree (24 examined, exit 0).
- Research feeds Alternatives/Decision: the waiver's two anchors are A2's two halves (identity measurement = measurement-provenance; per-test home isolation = the PR #2296 `userHome` precedent); A3 rejected by reference to issue #2300's unchosen class remedy; A4 by the issue #2063 → issue #2084/#2115 SessionRecipe sequencing — all three OPEN with matching titles; `workspace-project-composition.ts:70,130` do pass `options.userHome` as A4 states. Evidence-based, not asserted.
- Architecture Review Checklist: all 4 items `[x]`.
- Sibling scan: `[x]` with `N/A for new-surface placement` plus completion evidence; verified — `git grep -n getActiveResourcesInfo -- packages` returns exactly 1 file (`runtime-host.test.ts`, occurrences at 94, 102, 104).
- Alternatives Considered: A1, A2, A3, A4 — each with a Pro and a Con. A2's revised Pro names the mutant reproduction (`runtime-host.ts:96`) and the decoy-home pass; the decoy claim is independently reproduced below.
- Decision: names the deciding trade-off — A1 fixes the machine and not the instrument; A3/A4 are the root item's class remedies, outside a one-file `blocks-landing` scope.
- New-surface placement: N/A — one existing test file changes; no package, app, presentation/interface surface or layer reclassification.
- § Solution step 2 (revised) claim checked on Node v22.14.0 with an `async_hooks` probe: synchronously after `clearTimeout`, the Timeout is still alive with `hasRef() === true`; after one `await new Promise(setImmediate)` its `destroy` has fired (alive = 0). The macrotask yield is required exactly as the document says.
- Completion Criteria: TC-01…TC-05, every item prefixed; TC-01 identity measurement, TC-02 mutation proof with restore check, TC-03 decoy-home + empty-home runs with exit codes, TC-04 isolation control (`createDefaultUserSettingsSources()` and `homedir()`), TC-05 package suite + `harness:scan`; each a command or an observable; grep for "works correctly / no errors / implemented / displays correctly" returns nothing in the body.
- TC-03 (revised) reproducibility checked: a scratch home whose `.claude/settings.json` holds `{ hooks: { SessionStart: [{ matcher: '', hooks: [{ type: 'command', command, timeout }] }] } }` — the shape `config-types.ts:95-104` (`HookGroupSchema`, `SessionStart: z.array(HookGroupSchema)`) accepts — run as `HOME=<decoy> USERPROFILE=<decoy>` reproduces the real-home red on the unfixed test: `expected 3 to be less than or equal to 2`, `1 failed | 4 passed (5)`. `homedir()` (TC-04) follows `HOME` on this platform (probe: `HOME=/home/ubunutu` → `/home/ubunutu`).
- Test Plan: section present; rows TC-01…TC-05 = 5, matching 5 Completion Criteria; every row has a non-empty Test Type and Tool/Approach, no "TBD"; no row uses Tool "manual" — the manual-Notes requirement is N/A (TC-02's hand-run row carries a Notes entry regardless; TC-03's revised row records the decoy preparation).
- Structure — Tasks: section present with one unchecked placeholder naming the exact path, to be bound at GATE-IMPLEMENT. Evidence Log: present; not empty because this is not the first run — the catalogue's "(first GATE-WRITE run)" qualifier applies; the prior entry is retained above. No `## Status` / `## Classification` body sections.
- Reference qualification (revised): every `#<n>` in the body is prefixed `issue` or `PR` (the `issue #2084/#2115` pair shares one prefix); gh: issue #2383 OPEN, issue #1852 CLOSED, issue #2300 OPEN, issue #2063 OPEN, issue #2084 OPEN, issue #2115 OPEN, PR #2296 MERGED — titles match the roles assigned.
- Sequencing anchors: `finding-depth.md:37-39` states the three containment conditions the document lists; `.claude/agents/finding-depth-triager.md`, `scan-user-execution-plan-order.mjs`, `depth-verdict-reachable.test.mjs` exist; HARNESS-127 (done) records the same "root record held outside the tree" sequencing for HARNESS-128. `TEST-012` is absent from `git ls-files` and from `.agents/tasks/` — consistent with the stated sequencing; not judged here.
- Observation (not a GATE-WRITE criterion): A2's Con says "≈14 session-constructing files" and A3's Con "28–34 files construct a session" without defining either population; a constructor/factory grep over `packages/**/*.test.ts` finds 35 files (48 by `new Session(`/`new InteractiveSession(` alone). The A3 range is consistent with the measurement; the A2 figure is not derivable from the text. Neither number decides any criterion.
- Worktree observation (not a GATE-WRITE criterion): `git diff --stat develop -- packages` is empty; only this spec and the untracked paired task file `.agents/tasks/RUNTIME-007-….md` differ from `develop` — no implementation has begun.

### [GATE-WRITE] — ✅ PASS | 2026-08-28

**Status upgrade:** review-ready → review-ready (third run, after the `proposal-reviewer` round-2 REVISE revision of § Solution step 2 — two collections `seen`/`destroyed`, assertions `seen.size >= 1` and no undestroyed ref'd survivor — § Solution step 3 — `homedir()` load-bearing under `pool: 'forks'` — and A2's Con — the population behind the "≈14" figure; no transition — the document already holds the status this gate's PASS maps to, and the dispatcher directed that it not change)

- Ordering: GATE-WRITE is the entry gate — exempt from the prior-gate check. Input state coherent: `status: review-ready` in `.agents/spec-docs/backlog/` (`scan-doc-folder-status-agreement.mjs` → violations=0, exit 0). Evidence Log holds exactly two prior entries, both `[GATE-WRITE] — ✅ PASS | 2026-08-28` with per-criterion lines (neither a bare PASS); no later gate has run, so re-running GATE-WRITE over the revised text is in order (HARNESS-127 third-run precedent). Branch `fix/2383-runtime-host-test-measures-the-host` at `bb4c3626e` = `origin/develop`.
- Frontmatter — `---` block: present at line 1.
- Frontmatter — `status: draft`: literally unmet — the field reads `status: review-ready`. Judged N/A on this re-run for the reason the second entry records: `spec-workflow.md:168` maps `review-ready` to "GATE-WRITE passed, awaiting approval", which is this document's recorded history; the catalogue defines no `review-ready → draft` rewind; the write step was demonstrably not skipped (two specific prior entries).
- Frontmatter — `type: BEHAVIOR`: one of the 11 prefixes. `tags: [testing, async]`: present.
- Problem — symptom: the quoted `before` / `shutdown()` / `after` / `expect` block is verbatim at `runtime-host.test.ts:102-106` (102, 103, 104, 106). Re-run on this branch: real `HOME` (`~/.claude/settings.json` hooks `{SessionStart: 1}`) → `expected 3 to be less than or equal to 2`, `Tests 1 failed | 4 passed (5)`, exit 1; `HOME=USERPROFILE=<empty dir>` → `Tests 5 passed (5)`, exit 0. Matches the document's figures.
- Problem — cited mechanism re-verified line-for-line: `command-executor.ts:106` `const timer = setTimeout(() => {` (the statement closes at `:114`; an `async_hooks` `init` frame reports `:114:21` — the same statement); `session.ts:158` `fireSessionStartHook(`; `settings-source.ts:37-38` `userHome: string = process.env.HOME ?? process.env.USERPROFILE ?? '/'` and `:41-42` reading `<home>/.robota/settings.json` and `<home>/.claude/settings.json`; `interactive-session-project-context.ts:41` and `interactive-session-provider-switch.ts:17` call `createDefaultUserSettingsSources()` with no argument; `runtime-host.ts:96` `bound = setTimeout(resolve, RUNTIME_SHUTDOWN_TIMEOUT_MS)`; `:99` `if (bound !== undefined) clearTimeout(bound);` (the TC-02 mutant line). The attribution was reproduced **by identity**, not only by count: a scratchpad vitest file (`pool: 'forks'`, `async_hooks` bracket from `startRuntimeHost` through `shutdown()` plus one `setImmediate`) under the real home reports 1 survivor with `hasRef() === true`, created at `packages/agent-core/src/hooks/executors/command-executor.ts`.
- Problem — reproduction condition: explicit paragraph (any machine whose `~/.claude/settings.json` or `~/.robota/settings.json` defines a SessionStart command hook; independently, any vitest timer arming or expiring inside the shutdown window).
- Problem — no "TBD" / "TODO" / vague single sentence: grep over the body (everything before `## Evidence Log`) returns nothing; multi-paragraph with re-measured figures.
- Prior Art Research: section present; `Waived: <reason>` line at `:46`. Reason verified: `.agents/rules/measurement-provenance.md` exists; PR #2296 MERGED; issue #2300 OPEN and is the class it filed. `scan-spec-research.mjs` passes over the tree (24 examined, exit 0).
- Research feeds Alternatives/Decision: the waiver's two anchors are A2's two halves (identity measurement = measurement-provenance; per-test home isolation = the PR #2296 `userHome` precedent); A3 rejected by reference to issue #2300's unchosen class remedy; A4 by the issue #2063 → issue #2084/#2115 SessionRecipe sequencing (all three OPEN, titles match); `workspace-project-composition.ts:70,130` pass `options.userHome` as A4 states. Evidence-based, not asserted.
- Architecture Review Checklist: all 4 items `[x]`.
- Sibling scan: `[x]` with `N/A for new-surface placement` plus completion evidence; verified — `git grep -n getActiveResourcesInfo -- packages` returns exactly 1 file (`runtime-host.test.ts`, occurrences at 94, 102, 104).
- Alternatives Considered: A1, A2, A3, A4 — each with a Pro and a Con. A2's revised Con now defines its population: "28–35 files by constructor/factory grep" — reproduced: `new InteractiveSession(` 32 test files, plus `createInteractiveSession(` 34, plus `startRuntimeHost(` 35, inside the stated range. Its "≈14 by one grep heuristic ... neither inject a session, mock initialisation, pass `config:`, nor set `HOME`" did NOT reproduce here: excluding files matching any of `vi.mock(`, `process.env.HOME`, `config:`, `session:`, `userHome` leaves 1 of 35 under every variant tried. The text labels the figure a heuristic and assigns settling it to TEST-012; the Con stands without it and no criterion turns on it. Recorded as an observation.
- Decision: names the deciding trade-off — A1 fixes the machine and not the instrument; A3/A4 are the root item's class remedies, outside a one-file `blocks-landing` scope.
- New-surface placement: N/A — one existing test file changes; no package, app, presentation/interface surface or layer reclassification.
- § Solution step 2 (revised) checked on Node v22.14.0: synchronously after `clearTimeout`, the Timeout is alive with `hasRef() === true` (1); after one `await new Promise(setImmediate)` its `destroy` has fired (0) — the macrotask yield is required exactly as stated. The two-collection design (`seen` never shrunk; `destroyed` from `destroy`) run against the real `startRuntimeHost` under an isolated empty home: `seen` = 2, `destroyed` = 2, survivors with `hasRef()` = 0 — so both specified assertions (`seen.size >= 1`; no entry of `seen` absent from `destroyed` with `hasRef() === true`) hold on correct code. Observation: the parenthetical "on correct code under isolation `seen` is exactly the bound" is not what was measured — the second `Timeout` is a vitest RPC `sendCall` timer (`vitest/dist/chunks/index.*.js:57`), destroyed within the window; it is the in-window vitest timer the Problem and A1's Con already name, and A2's second assertion tolerates it only while it is destroyed or unref'd by read time (2/2 runs here). The assertions as written are unaffected; the parenthetical overstates and TC-01 will settle it.
- § Solution step 3 (revised) checked: `vitest.shared.ts:110` is `pool: 'forks'`. `homedir()` reachability measured: a `worker_thread` that reassigns `process.env.HOME`/`USERPROFILE` still returns the real home (`/home/ubunutu`); a process spawned with `HOME=/tmp/isolated-home` returns `/tmp/isolated-home`; main-thread in-process reassignment also follows — so "`process.env.HOME` reaches `os.homedir()` only in a forked worker" is correct for vitest's worker kinds. `initial-contribution-sources.ts:12,20` are `userHome: string = homedir()`; `interactive-session-init.ts:91` is `join(homedir(), '.robota', 'plugins')`. Observation: "two of the three framework home readers" understates the count — `git grep` over `packages/agent-framework/src` (non-test) finds home readers also at `settings-io.ts:15`, `update-check-cache.ts:33`, `user-local/storage.ts:116`, `org-policy-loader.ts:30`, `paths.ts:17`; the extra readers strengthen the load-bearing point rather than weaken it.
- Completion Criteria: TC-01…TC-05, every item prefixed; coverage per sub-item — measurement (TC-01 identity assertion, TC-02 mutation with restore check), isolation (TC-03 decoy + empty home with exit codes, TC-04 `createDefaultUserSettingsSources()` and `homedir()` control), suite (TC-05 package run + `harness:scan`); each a command or an observable; grep for "works correctly / no errors / implemented / displays correctly" returns nothing in the body.
- TC-03 reproducibility re-checked: a scratch home whose `.claude/settings.json` holds `{ hooks: { SessionStart: [{ matcher: '', hooks: [{ type: 'command', command: 'sleep 2', timeout: 5 }] }] } }` (the `HookGroupSchema` shape at `config-types.ts:94-104`), run as `HOME=<decoy> USERPROFILE=<decoy>`, reproduces the real-home red on the unfixed test: `expected 3 to be less than or equal to 2`, `Tests 1 failed | 4 passed (5)`.
- Test Plan: section present; rows TC-01…TC-05 = 5, matching 5 Completion Criteria; every row has a non-empty Test Type and Tool/Approach, no "TBD"; no row uses Tool "manual" — the manual-Notes requirement is N/A (the TC-02 hand-run row and the TC-03 row carry Notes regardless).
- Structure — Tasks: section present with one unchecked placeholder naming the exact path, to be bound at GATE-IMPLEMENT. Evidence Log: present; not empty because this is the third run — the catalogue's "(first GATE-WRITE run)" qualifier applies; both prior entries are retained above. No `## Status` / `## Classification` body sections.
- Reference qualification: every `#<n>` in the body is prefixed `issue` or `PR` (the only bare token is the second half of `issue #2084/#2115`); gh: issue #2383 OPEN, issue #1852 CLOSED, issue #2300 OPEN, issue #2063 OPEN, issue #2084 OPEN, issue #2115 OPEN, PR #2296 MERGED — titles match the roles assigned.
- Sequencing anchors: `finding-depth.md:37-39` states the three containment conditions the document lists; `.agents/spec-docs/done/HARNESS-127-….md:82` records the same "held outside the tree until the checkpoint" sequencing for HARNESS-128; `TEST-012` is absent from `git ls-files` and from `.agents/tasks/` — consistent with the stated sequencing; not judged here.
- Worktree observation (not a GATE-WRITE criterion): `git status --porcelain` lists only this spec and the untracked paired task file `.agents/tasks/RUNTIME-007-….md`; `git diff --stat develop -- packages` is empty — no implementation has begun. All probe artifacts were written under the session scratchpad only.

### [GATE-APPROVAL] — ✅ PASS | 2026-08-28

**Status upgrade:** review-ready → approved
**Approval route:** `DIRECT`
**Instruction (verbatim):** "봉쇄로 승인 (권장)"
**Given:** 2026-08-28, this conversation

- Ordering — prior gate: three `[GATE-WRITE] — ✅ PASS | 2026-08-28` entries above (lines 228, 250, 279), each carrying per-criterion evidence lines — none is a bare PASS; the third post-dates the `proposal-reviewer` round-2 REVISE and is the document's last write.
- Ordering — input state: frontmatter `status: review-ready`; file under `.agents/spec-docs/backlog/`, the folder `spec-workflow.md` § Spec-Document Status and Lifecycle Folders maps to `review-ready`; `node scripts/harness/scan-doc-folder-status-agreement.mjs` → violations=0, exit 0.
- Route: `backlog-execution.md` § Delegated Approval Classes registry holds exactly one row, `_(none registered)_` — zero classes, so Route CLASS is unavailable and this entry takes Route DIRECT. The four CLASS-only criteria (registered class predating approval, verbatim standing instruction, evidence condition by measurement, item inside the class boundary) are N/A on DIRECT.
- DIRECT — explicit approval in the current conversation: the owner, in this conversation on 2026-08-28, first asked what "봉쇄" means and for a recommendation with grounds; the agent explained `finding-depth.md`'s containment (root item filed, minimal labelled change, `Contained — <ID>.`) and recommended containment on four grounds; the owner then selected "봉쇄로 승인 (권장)" from a structured question titled "RUNTIME-007 (#2383) 진행 방식을 정해 주세요." whose other options were "재계획 — TEST-012 먼저" and "보류". The selection contains "승인", which the catalogue lists as counting; it is not a clarifying-question answer ("C"/"ㅇㅇ"/"응"), not silence, and not a standing category instruction.
- DIRECT — directed at this spec document: the question names RUNTIME-007 (#2383) in its title and the chosen option describes this document's design — one file `runtime-host.test.ts`, identity-based timer measurement, per-test empty-HOME isolation labelled `Contained — TEST-012.`, one control case, root cause registered as TEST-012 / issue #2300 — which is § Decision A2 as written. No other spec document was under discussion in the conversation, so "approval of a different item" does not apply.
- No Architecture Review or frontmatter type/tags modified after approval: the file's last write is 2026-08-28 00:34:36 KST and its content ends at the third GATE-WRITE entry (line 306 before this entry); frontmatter reads `type: BEHAVIOR`, `tags: [testing, async]`; § Architecture Review holds A1–A4, Decision "A2, as a labelled containment under TEST-012", and a 4/4 `[x]` checklist — exactly what the third GATE-WRITE entry recorded. The file is untracked, so there is no git history to diff; the worktree (`git status --porcelain`) lists only this spec and the paired Task, and the paired Task's own mtime (00:34:22 KST) precedes the spec's last write.
- Independent architecture validation (conditional): N/A — the spec introduces no new package, app, presentation or interface surface and reclassifies no layer or product-family boundary; § Affected Files names one existing test file, `packages/agent-framework/src/runtime/__tests__/runtime-host.test.ts`, and § Affected Scope states "No production path in `packages/`". Recorded as context, not as the deciding evidence: the paired Task `.agents/tasks/RUNTIME-007-….md` § Recommendation gate records `proposal-reviewer` REVISE → REVISE → **REVIEW VERDICT: ENDORSE** (2026-08-28), alternative A2 chosen.
- NON-COMPLIANCE trigger (implementation before this gate): not tripped — branch `fix/2383-runtime-host-test-measures-the-host` `HEAD` = `origin/develop` = `bb4c3626e`; `git diff --stat origin/develop -- packages` is empty; `git status --porcelain` lists only the two untracked RUNTIME-007 documents.
- Evidence form: this entry carries `**Approval route:**`, `**Instruction (verbatim):**`, `**Given:**` in the shape `backlog-execution.md` § Delegated Approval Classes fixes for Route DIRECT; `classifyApproval` from `scan-standing-delegation-evidence.mjs` run on this entry with the live form and registry → `{ route: 'DIRECT' }` (recorded in the guard's return).

### [GATE-IMPLEMENT] — ✅ PASS | 2026-08-28

**Status upgrade:** approved → in-progress

- Ordering — prior gate: `[GATE-APPROVAL] — ✅ PASS | 2026-08-28` above (line 308), route `DIRECT`, with per-criterion evidence lines and the `**Approval route:** / **Instruction (verbatim):** / **Given:**` form (not a bare PASS).
- Ordering — input state: frontmatter `status: approved`; file under `.agents/spec-docs/todo/`, which `spec-workflow.md:169` maps to `approved`. Branch `fix/2383-runtime-host-test-measures-the-host`, HEAD `2f9487ebe` (prelude commit, 2026-08-28 00:47:27 KST; parent = merge-base with `origin/develop` = `bb4c3626e`).
- Task file created: `.agents/tasks/RUNTIME-007-runtime-host-shutdown-timer-test-measures-the-process-not-the-host.md` exists, tracked in `2f9487ebe` (116 lines), `status: todo`, `issue: …/2383` (issue #2383 OPEN, title matches), `## Bound spec document` names this file's exact path.
- Tasks file path recorded in `## Tasks`: yes — the single row names the exact path above.
- Tasks correspond to Completion Criteria: the Task carries no checkbox plan (per `.agents/tasks/README.md` § "What this tree is NOT", a Task is the problem statement, not a breakdown); its `## Test Plan` holds 4 bullets covering all 5 TCs — bullet 1 (identity tracking via `async_hooks`, one `setImmediate` yield, `seen.size >= 1`, red under the `clearTimeout(bound)` mutant, recorded) → TC-01 and TC-02; bullet 2 (`HOME`/`USERPROFILE` isolation labelled `Contained — TEST-012.`, passes under a decoy home with a planted SessionStart hook and under an empty home) → TC-03; bullet 3 (control: `createDefaultUserSettingsSources()` and `homedir()` under the isolated and the restored home) → TC-04; bullet 4 (`vitest run` on file and package, `pnpm harness:scan` exit 0) → TC-05. No TC is uncovered.
- Task `## Test Plan` ≥ 50 chars: section body is 1394 chars; `node scripts/harness/scan-test-plan.mjs` → 42 documents examined, exit 0 [AF-24].
- Exact PLAN outcome: the Task's `## User Execution Test Scenarios` carries exactly one `**Author verdict:** \`SCENARIO DRAFTED: not-applicable | 0\``line with the concrete reason (one test file's measurement and environment isolation; no CLI, TUI, published API or runtime behaviour changes; the only observable is the test's own red/green). Subject-bound PLAN ledger record present and uncommitted in`.agents/loop-runs/user-execution-scenario.jsonl`line 7:`runId r20260827151420`, `opened 2026-08-27T15:14:20.165Z`, `closed 2026-08-27T15:14:20.219Z`, `terminal converged`, `roundFindings [0]`, `ref`=`.agents/tasks/RUNTIME-007-runtime-host-shutdown-timer-test-measures-the-process-not-the-host.md`(exact Task path). Not retrospective: the record closed at 00:14:20 KST, the Task's committed copy in`2f9487ebe` (00:47:27 KST) already carries the verdict line (`git show HEAD:<task>`line 107), and this gate ran after both. A`DONE-GATE-STAGE-1`PASS is not required for a`not-applicable` outcome.
- Whole worktree path inventory (`git status --short --untracked-files=all`, all paths): ` M .agents/loop-runs/user-execution-scenario.jsonl` — one appended line (`git diff --numstat` = `1 0`), nothing else staged, unstaged, untracked, renamed or deleted. Committed beyond the merge-base (`git diff bb4c3626e --stat`): `.agents/loop-runs/user-execution-scenario.jsonl` 1/0, `.agents/spec-docs/todo/RUNTIME-007-runtime-host-shutdown-timer-test-measures-the-process-not-the-host.md` 323/0, `.agents/tasks/RUNTIME-007-runtime-host-shutdown-timer-test-measures-the-process-not-the-host.md` 116/0 — exactly the paired Task/spec planning artifacts and the subject-bound PLAN ledger record. The TEST-012 root record is absent from the tree (`git ls-files | grep TEST-012` empty), as § "Sequencing the root record" requires until the implementation commit.
- NON-COMPLIANCE trigger (implementation before this gate): not fired — `git diff bb4c3626e --stat -- packages/` is empty; `node scripts/harness/scan-user-execution-plan-order.mjs` → `::examined:: 1 topic commit(s)`, exit 0. Note: `origin/develop` has advanced to `2c875dd3e` since the branch was cut; a raw `git diff origin/develop` shows INFRA-134 / `claude-code-review.yml` / `scan-claude-review-coverage.mjs` deltas that are upstream commits absent from this branch, not work on it — the merge-base diff above is the authoritative inventory.
