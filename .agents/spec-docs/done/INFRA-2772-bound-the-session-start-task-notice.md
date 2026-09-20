---
status: done
type: INFRA
tags: [harness, hooks]
lane: L2
---

# INFRA-2772: Bound the SessionStart Task notice to what is actually in progress

Paired with `.agents/tasks/INFRA-2772-bound-the-session-start-task-notice.md`. Arising from [issue #2772](https://github.com/woojubb/robota/issues/2772).

## Problem

`.claude/hooks/task-tracking.sh start` — registered on `SessionStart`, which fires on startup,
resume, `/clear` and after every compaction — prints one line per open Task file under
`.agents/tasks/`, every one of them suffixed `— in progress`.

Measured on `develop` at `4e1597e8bf` (2026-09-20), with
`bash .claude/hooks/task-tracking.sh start | wc -c`:

- 166 Task files → **14,855 bytes** injected into the agent's opening context, each session start and
  each compaction.
- The frontmatter says `status: todo` for **122** of them and `status: in-progress` for **44**. The
  notice calls all 166 "in progress" and tells the agent to "read the task file(s) before starting
  work" — for a backlog of 122 not-yet-started items that instruction is false, and the false part is
  82% of the output.
- The block has no bound. The open-issue block eleven lines above it in the same script caps at 20 and
  prints "showing the first 20 — there are more" precisely because "a bounded list that does not say
  it is bounded" is the defect class this repository counts; the Task block never adopted the same
  rule, so it grew with the tree.
- Cost of the classification itself: one `node` process per Task file (`classify_task` spawns
  `task-lifecycle.mjs classify <file>`), so a session start pays 166 process spawns before the notice
  appears — measured ~6 s on the author's machine.

The reconcile question the issue also raises (22 `in-progress` Tasks whose registering issue is
closed) is **out of this document's scope**: 20 of the 22 were closed `NOT_PLANNED` on 2026-09-12 by
the RULE-023 migration (decomposition moved from child issues into Tasks), so a closed issue does not
mean a finished Task, and the two with `COMPLETED` issues still have unchecked plan items. Their status
is each owner's call, not a mechanical rewrite; it is recorded on issue #2772 as a follow-up.

## Prior Art Research

Waived: Internal hook output shaping with no external product surface; the design constraint (a bounded list must announce its bound) is already stated by the same script's open-issue block, so there is no prior art to consult.

## Architecture Review

### Affected Scope

- `.claude/hooks/task-tracking.sh` — the `start` and `stop` modes' Task listing
- `scripts/harness/task-lifecycle.mjs` — the shared classifier gains a one-process directory mode
- `scripts/harness/__tests__/task-notice-is-bounded.test.mjs` — new; the red-proof for TC-01
- `scripts/harness/__tests__/remaining-hooks-run.test.mjs` — existing `task-tracking` cases must stay
  green unchanged (they pin `TASK-1.md — in progress` and `TASK-2.md — DONE`)
- `.agents/skills/task-tracking/SKILL.md` — one line describing what the session notice shows

### Alternatives Considered

1. Print only `in-progress` and `blocked` Tasks, capped and announced; report `todo` as a count.
   - Pro: removes the 82% that is not in progress and bounds the rest; keeps every actionable line
     (DONE-needs-archival, INVALID) exactly as today; the bound announces itself, matching the
     open-issue block's contract.
   - Con: a `todo` Task is no longer named at session start — but the notice never was the way to pick
     work (`finding-depth.md`: open issues outrank unfiled backlog work; the backlog index owns the
     rest), so nothing that depended on it is lost.
2. Keep printing every open Task but cap the list at N and announce the bound.
   - Pro: smallest diff.
   - Con: still calls `todo` items "in progress", and with 122 `todo` files sorted by name ahead of
     most `in-progress` ones the cap would cut the very entries that are in progress — the notice
     would be bounded and wrong.
3. Move `todo` Tasks out of `.agents/tasks/` (a `backlog/` subdirectory) so the hook's glob no longer
   sees them.
   - Pro: no hook change.
   - Con: rewrites the Task tree contract (`check-backlog-placement`, `check-task-archival`,
     `task-lifecycle` all assume one directory plus `completed/`) and every path recorded in Evidence
     Logs and AGREEMENT rollups — a far larger blast radius to save a 20-line hook change.

### Decision

Alternative 1. The notice lists what its own instruction ("read before starting work") is true for —
`in-progress` and `blocked` — capped at `TASK_SHOW=20` with the same "showing the first N of M" line
the open-issue block uses, and states the `todo` count with a pointer instead of the entries. DONE and
INVALID lines keep their current form and are never capped: they are instructions, not inventory.

Classification stays with the single owner (`task-lifecycle.mjs`); it gains a `classify-dir <dir>`
mode that prints `<basename>\t<state>\t<status>` for every non-README `*.md` directly under the
directory in one process, so the hook spawns `node` once instead of once per file. `classify <file>`
is unchanged for its other callers.

Validation (contract boundary is the hook's output, read by the agent and by tests):

- Reachability: `start` and `stop` modes both go through the new listing; the existing
  `remaining-hooks-run.test.mjs` cases execute both paths.
- Capability preservation: the three assertions those cases pin (`TASK-1 — in progress`, not
  `TASK-1 — DONE`, `TASK-2 — DONE`) hold on the new output; `stop` mode's DONE/INVALID reminders are
  byte-for-byte the same text.
- Adversarial pass: a `todo` Task must not appear as an entry; a 21st `in-progress` Task must produce
  the announced bound; a directory with only `todo` Tasks still exits 0 and prints the count line — all
  three are TC-01 cases.

**Delivery mode:** `single`

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료
- [x] Sibling scan 완료 — the open-issue block in the same script is the sibling; its cap-and-announce
      contract (`ISSUE_SHOW`, "showing the first N — there are more") is what this change copies to
      the Task block.
- [x] 대안 최소 2개 검토 완료
- [x] 결정 근거 문서화 완료
- [x] New-surface placement: **N/A** — no new package, app, presentation or interface surface, and
      no layer or product-family reclassification.

## Fallback & Degradation Declaration

One degradation path, and it is labelled rather than substituted for: if `classify-dir` cannot run
(no `node` on PATH, a thrown error), the hook keeps the exit status and the first stderr line and
prints one block — `Could not classify Task files: task-lifecycle.mjs classify-dir exited N (<reason>)`,
the number of `.md` files that were NOT classified, and the command to run by hand — in both `start`
and `stop` modes, then exits 0. It prints no count line and no per-file INVALID line in that case:
"could not classify" and "classified as invalid" are different answers (the first version conflated
them under a false `0 open` headline — review finding, Round A). A single file the classifier could not
read is reported on its own line as `unreadable`, distinct from `invalid` frontmatter. The hook never
exits non-zero on a classification failure and never prints nothing (enforcement-architecture.md,
"Silence is not success").

## Solution

1. `scripts/harness/task-lifecycle.mjs` — add `classify-dir <dir>`: read every `*.md` directly under
   `<dir>` except `README.md`, sorted by name; print one line per file,
   `<basename>\t<open|terminal|invalid>\t<status or ->`; exit 0 (per-file validity is in the line, not
   the exit code). `classify <file>` unchanged.
2. `.claude/hooks/task-tracking.sh` — replace the per-file `classify_task` loop with one
   `classify-dir` call read into arrays; in `start` mode print:
   - `[task-tracking] Tasks in .agents/tasks/: <open> open — <n> in-progress, <n> blocked, <n> todo.`
   - the `in-progress`/`blocked` entries, at most `TASK_SHOW=20`, each `  - <file> — in progress` /
     `  - <file> — blocked`, followed by `  (showing the first 20 of <M> — the rest: ls .agents/tasks/)`
     only when M > 20;
   - the `todo` count line: `[task-tracking] <n> todo Task(s) are not listed; choose work through the
backlog, not this notice.`;
   - DONE and INVALID lines exactly as today, uncapped, and the existing archival instruction.
     `stop` mode keeps its output; only the classification call changes.
3. `scripts/harness/__tests__/task-notice-is-bounded.test.mjs` — new cases: a `todo` Task is counted
   and not listed; 21 `in-progress` Tasks print 20 entries and the bound line; a DONE Task is still
   flagged; `classify-dir` prints one line per file with the status column.
4. `.agents/skills/task-tracking/SKILL.md` — state that the session notice lists `in-progress` and
   `blocked` Tasks (bounded) and counts `todo`.

## Affected Files

- `.claude/hooks/task-tracking.sh`
- `scripts/harness/task-lifecycle.mjs`
- `scripts/harness/__tests__/task-notice-is-bounded.test.mjs`
- `.agents/skills/task-tracking/SKILL.md`
- `.agents/spec-docs/draft/INFRA-2772-bound-the-session-start-task-notice.md`
- `.agents/tasks/INFRA-2772-bound-the-session-start-task-notice.md`

## Completion Criteria

- [x] TC-01: `pnpm exec vitest run scripts/harness/__tests__/task-notice-is-bounded.test.mjs` → exits 0,
      and exits 1 with the hook change reverted (the `todo`-not-listed and bound-line cases go red)
- [x] TC-02: `node scripts/harness/run-all-scans.mjs --affected --context pr --skip dist --skip build-contracts` → exits 0
- [x] TC-03: `pnpm exec vitest run hooks-run.test.mjs open-issues-are-shown.test.mjs` → exits 0 — the two
      existing hook suites (`scripts/harness/__tests__/remaining-hooks-run.test.mjs`,
      `open-issues-are-shown.test.mjs`), selected by vitest name filter, unchanged by this work
- [x] TC-04: `TASK_TRACKING_SKIP_ISSUES=1 bash .claude/hooks/task-tracking.sh start | wc -c` on the current tree (the Task block alone; the open-issue block is not this item's) → under 3,000 bytes (was 14,855), and the output contains one `showing the first 20 of` line

## Test Plan

| TC-ID | Test Type | Tool / Approach                                        | Notes                                                                                                                                                                                                                                              |
| ----- | --------- | ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TC-01 | Unit      | `pnpm exec vitest run` on the new test file            | Test written: `scripts/harness/__tests__/task-notice-is-bounded.test.mjs > task-tracking start — the Task block is bounded to what is in progress` (+ the `classify-dir` describe). RED with the hook change reverted (4 of 8 fail), GREEN with it |
| TC-02 | Suite     | `run-all-scans.mjs --affected --context pr`            | Test skipped: no unit test — the affected scan run is itself the automated regression check; recorded as a `[GATE-COMPLETE: TC-02]` command entry                                                                                                  |
| TC-03 | Unit      | `pnpm exec vitest run` on the two existing hook suites | Test written (pre-existing): `scripts/harness/__tests__/remaining-hooks-run.test.mjs > task-tracking` and `scripts/harness/__tests__/open-issues-are-shown.test.mjs` — capability preservation                                                     |
| TC-04 | Measure   | `bash .claude/hooks/task-tracking.sh start \| wc -c`   | Test skipped: a byte count on the live tree is a measurement, not a unit test; the bound itself is pinned by `task-notice-is-bounded.test.mjs > caps the list at 20 and says so`                                                                   |

## User Execution Test Scenarios

Not applicable.

**Reason:** The change is to a repository-internal Claude Code SessionStart hook whose only output
is the context notice the agent reads at session start; no end user of the Robota product (CLI,
SDK, TUI, MCP server) can observe it through any runnable product surface. Engineering verification
is TC-01 to TC-04 above.

## Tasks

- [x] `.agents/tasks/completed/INFRA-2772-bound-the-session-start-task-notice.md` — done

## Evidence Log

### [GATE-WRITE] — ✅ PASS | 2026-09-20

**Status upgrade:** draft → review-ready

Ordering check: GATE-WRITE is the entry gate (no prior status gate, `gate-catalogue.md` § Prior-gate map); document is `status: draft` under `spec-docs/draft/` — matches the expected input state. No implementation has preceded this gate: `git diff origin/develop -- .claude/hooks/task-tracking.sh scripts/harness/task-lifecycle.mjs .agents/skills/task-tracking/SKILL.md` is empty and `scripts/harness/__tests__/task-notice-is-bounded.test.mjs` does not exist.

Mechanical set (`node scripts/harness/gate.mjs judge --gate GATE-WRITE --doc <this> --dry-run`, re-run by the guardian: 20 PASS, 0 FAIL, 7 PENDING-GUARDIAN, exit 2):

- GATE-WRITE — File begins with `---` YAML frontmatter block: file begins with a `---` frontmatter block
- GATE-WRITE — `status: draft` present in frontmatter: `status: draft`
- GATE-WRITE — `type:` is exactly one value from the 11-prefix list: `type: INFRA`
- GATE-WRITE — `tags:` field present in frontmatter: present (2 values)
- GATE-WRITE — Does not contain "TBD", "TODO", or vague single-sentence descriptions: `## Problem` has no TBD/TODO; 1880 chars, 9 sentences
- GATE-WRITE — `## Prior Art Research` (or `## Research`) section present: present
- GATE-WRITE — Section is substantiated OR explicitly waived: `scan-spec-research` reports an explicit `Waived:` line with a reason
- GATE-WRITE — All 4 checklist items are `[x]`: 5/5 `[x]`
- GATE-WRITE — Sibling scan item is `[x]` with completion evidence or `N/A: <reason>`: `[x]` with completion evidence (the open-issue block in the same script named as the sibling)
- GATE-WRITE — Alternatives Considered has at least 2 entries with pro/con: 3 numbered alternatives, each with Pro and Con
- GATE-WRITE — Every Completion Criteria item has a `TC-N` prefix: 4 criteria, all `TC-NN:` prefixed
- GATE-WRITE — No criterion uses the banned phrases: none of "works correctly", "no errors", "implemented", "displays correctly" appears
- GATE-WRITE — `## Test Plan` section present: present
- GATE-WRITE — One Test Plan row per TC-N: 4 rows = 4 TC criteria (TC-01..TC-04)
- GATE-WRITE — Each row has non-empty Test Type and Tool/Approach: 4 rows, no TBD
- GATE-WRITE — Manual rows have a Notes entry: 0 manual rows
- GATE-WRITE — Tasks section present with placeholder: `## Tasks` names `.agents/tasks/INFRA-2772-bound-the-session-start-task-notice.md — todo`
- GATE-WRITE — Evidence Log section present and empty (first run): present with 0 prior entries before this one
- GATE-WRITE — No `## Status` / `## Classification` body sections: none

Semantic set (judged by `backlog-gate-guard`, each claim checked against the tree at HEAD `e040f298fe`):

- GATE-WRITE — Contains a concrete symptom: PASS. Names the command (`bash .claude/hooks/task-tracking.sh start | wc -c`), its output (14,855 bytes; 166 lines each suffixed `— in progress`), and what is wrong (122 `status: todo` Tasks labelled "in progress" = 82% of the output; no bound; one `node` spawn per file). Verified: `.claude/hooks/task-tracking.sh` lines 226-264 spawn `task-lifecycle.mjs classify` per file inside an uncapped loop printing `— in progress`, while the open-issue block (lines 68, 206-211) caps at `ISSUE_SHOW=20` and prints "showing the first 20 — there are more". Re-measured on this tree: 167 Task files (166 + this branch's own untracked Task), 44 `in-progress`, 0 `blocked`, every one of the 167 printed as `— in progress`; 13,935 bytes with `TASK_TRACKING_SKIP_ISSUES=1` (the cited 14,855 included the issue block).
- GATE-WRITE — Contains a reproduction condition: PASS. States the trigger (`SessionStart`, which fires on startup, resume, `/clear` and after every compaction — confirmed registered in `.claude/settings.json` under `SessionStart`), the tree and date it was measured on (`develop` at `4e1597e8bf`, 2026-09-20 — a real commit, PR #2768 merge), and the precondition (any `.agents/tasks/` with `todo` Tasks). Reproduced by the guardian on this tree with the same command.
- GATE-WRITE — Research findings feed `Alternatives Considered` / `Decision`: PASS. Research is waived with a stated basis — the same script's open-issue block already states the design constraint (a bounded list must announce its bound) — and that basis demonstrably drives the recommendation: Alternative 1's Pro names "matching the open-issue block's contract", Alternative 2's Con is a measured consequence of the tree (122 `todo` files sorted by name ahead of `in-progress` ones would be what a plain cap keeps — "bounded and wrong"), Alternative 3's Con names the three scripts that assume one directory (`check-backlog-placement.mjs`, `check-task-archival.mjs`, `task-lifecycle.mjs` — all exist), and the Decision copies the sibling's `SHOW=20` + "showing the first N of M" contract. The recommendation is derived from measurement and the in-repo reference, not asserted.
- GATE-WRITE — Decision references the trade-off that drove the choice: PASS. The Decision states the trade it makes — list only what the notice's own instruction ("read before starting work") is true for (`in-progress`/`blocked`), and give up naming `todo` Tasks in exchange for a count plus a pointer — and why the loss is acceptable (the notice was never the way to pick work; `finding-depth.md` line 33 confirms open issues outrank unfiled backlog work). It also states the boundary it keeps (DONE/INVALID lines uncapped: "instructions, not inventory") and the one-process classifier trade (one spawn vs 166, `classify <file>` unchanged for other callers).
- GATE-WRITE — New-surface placement (conditional): N/A, stated explicitly in the checklist and verified. Affected files are an existing hook, an existing harness script gaining a subcommand, one new test file, and one skill doc line — no new package, app, presentation or interface surface, and no layer / product-family reclassification.
- GATE-WRITE — At least 1 criterion per distinct feature or sub-item: PASS. Features: (a) bounded `in-progress`/`blocked` listing with an announced bound → TC-01 (21→20 + bound line case) and TC-04 (real-tree `showing the first 20 of` line, 44 in-progress today so the bound is exercised); (b) `todo` counted, not listed → TC-01 (todo-not-listed case); (c) DONE/INVALID lines preserved → TC-01 (DONE still flagged) and TC-03 (pinned `TASK-2.md — DONE`, `TASK-1.md — in progress` at `remaining-hooks-run.test.mjs` lines 294-307, covering both `start` and `stop` paths); (d) `classify-dir` output shape → TC-01; (e) byte-size outcome → TC-04; (f) regression → TC-02. The one non-behavioural sub-item — the SKILL.md line — has no TC; it is carried by the paired Task's Plan item (`.agents/tasks/INFRA-2772-…md` line 32), which GATE-VERIFY requires `[x]`, and the repository's done specs split evenly on giving doc lines a TC (21 of 45 sampled), so this is not read as an unmet criterion.
- GATE-WRITE — Each criterion uses Command form or Observable behavior form: PASS. TC-01, TC-02, TC-03 are command + exit code (TC-01 additionally states its red condition: exit 1 with the hook change reverted); TC-04 is command + numeric threshold (< 3,000 bytes, was 14,855) + one named observable line. No vague language.

TC-N count: 4 in Completion Criteria, 4 in Test Plan — match.

**Judged by:** independent `backlog-gate-guard` semantic evaluator
**Judged at:** HEAD `e040f298fe53` · base `origin/develop@e040f298fe53` · document `.agents/spec-docs/draft/INFRA-2772-bound-the-session-start-task-notice.md` blob `ad67d81e9173` (untracked)

### [GATE-APPROVAL] — ✅ PASS | 2026-09-20

**Status upgrade:** review-ready → approved
**Approval route:** `DIRECT`
**Instruction (verbatim):** "승인함"
**Given:** 2026-09-20, this conversation
**Review fingerprint:** a5d5b59704ba (review 6302bcba, type/tags f186cc84)

- GATE-APPROVAL — User has provided explicit approval in the current conversation: route DIRECT; `**Instruction (verbatim):**` recorded, given 2026-09-20, this conversation
- GATE-APPROVAL — The named class exists in the delegated-class registry, and its registry entry predates this approval. `backlo: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The authorising instruction is recorded verbatim, with its date and the session it was given in: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The class's stated evidence condition is shown to be met by measurement, not by assertion: route DIRECT, so the Route CLASS criterion does not apply
- GATE-APPROVAL — No Architecture Review or frontmatter type/tags modified after approval: the `**Review fingerprint:**` recorded at approval (a5d5b59704ba) equals the document's current fingerprint

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `e040f298fe53` · base `origin/develop@e040f298fe53` · document `.agents/spec-docs/backlog/INFRA-2772-bound-the-session-start-task-notice.md` blob `f7771b0dd1fe` (untracked)

### [GATE-APPROVAL] — ✅ PASS | 2026-09-20

**Status upgrade:** review-ready → approved
**Approval route:** `DIRECT`
**Instruction (verbatim):** "승인함"
**Given:** 2026-09-20, this conversation
**Review fingerprint:** a5d5b59704ba (review 6302bcba, type/tags f186cc84)

Ordering check (`gate-catalogue.md` § Prior-gate map, row GATE-APPROVAL, re-run rule `recorded-pass`): the `[GATE-WRITE] — ✅ PASS | 2026-09-20` entry above carries `**Status upgrade:** draft → review-ready`, and the document's current frontmatter is `status: review-ready` under `.agents/spec-docs/backlog/` — the folder `spec-workflow.md` § Spec-Document Status and Lifecycle Folders maps to `review-ready`. Corroborated; the prior gate was not skipped. NON-COMPLIANCE trigger (implementation before this gate) checked and absent: `git log origin/develop..HEAD` is empty, `git diff origin/develop -- .claude/hooks/task-tracking.sh scripts/harness/task-lifecycle.mjs .agents/skills/task-tracking/SKILL.md` is empty, `scripts/harness/__tests__/task-notice-is-bounded.test.mjs` does not exist, and `git grep classify-dir -- scripts .claude` finds nothing; the only untracked paths are this document and its paired Task.

Mechanical set re-run by the guardian (`node scripts/harness/gate.mjs judge --gate GATE-APPROVAL --doc <this> --dry-run`): 9 criteria — 6 PASS, 0 FAIL, 3 PENDING-GUARDIAN, exit 2. The standing `approve` entry above is in the `backlog-execution.md` § Delegated Approval Classes DIRECT form (route, verbatim instruction, `Given: <date>, this conversation`), and its `**Review fingerprint:** a5d5b59704ba` still equals the document's current fingerprint.

Semantic set (judged by `backlog-gate-guard`):

- GATE-APPROVAL — Approval is a direct, unambiguous statement directed at this spec document: PASS. The recorded instruction is "승인함" — the listed explicit form "승인" with a declarative ending, not a clarifying-question answer ("C", "ㅇㅇ", "응"), not silence, and not a category instruction. It was given in direct reply to a message that summarised THIS document's § Decision and asked "이 설계로 진행해도 될까요? (\"승인\" 또는 \"진행해\" 같은 명시적 표현이 필요합니다)". The five summarised points each map to a sentence of § Decision / § Solution in the document as it stands: (1) `in-progress`/`blocked` list capped at `TASK_SHOW=20` with the "showing the first N of M" line (Decision ¶1); (2) `todo` reported as a count with a pointer (Decision ¶1, Solution 2); (3) `classify-dir <dir>` one-process classification in `task-lifecycle.mjs` (Decision ¶2, Solution 1); (4) new `task-notice-is-bounded.test.mjs` plus one `SKILL.md` line (Solution 3-4); (5) the reconcile question declared out of scope (Problem, last paragraph). No other spec document was under discussion in that exchange, so the approval cannot be read as approval of a different item. Directedness is established on the dispatching orchestrator's account of its own conversation — the guardian is a subagent of that conversation, not another session, so this is not a relay under the catalogue's definition; the content of that account was checked against the document point by point rather than taken as asserted.
- GATE-APPROVAL — The item is inside the class as the registry defines it — a boundary the guard evaluates, not one the entry argues for: N/A. The route is `DIRECT`; no delegated class is cited and none is relied on, so there is no class boundary to evaluate. Recorded rather than skipped.
- GATE-APPROVAL — **Independent architecture validation (conditional):** N/A — condition not met, verified against the tree, not the checklist's claim. § Affected Files names an existing hook (`.claude/hooks/task-tracking.sh`, whose `classify_task` loop and `ISSUE_SHOW=20` block exist at lines 226-264 and 68/206-211), an existing harness script gaining a second subcommand (`scripts/harness/task-lifecycle.mjs`, today `classify <file>` only, line 77), one new unit-test file, and one line in an existing skill doc. No new package, app, or presentation/interface surface is introduced and no layer / product-family boundary is reclassified (`spec-workflow.md` § New-Surface Architecture Placement), so no independent `proposal-reviewer` verdict or `architecture-audit-fanout` result is required. The checklist's "New-surface placement: N/A" is consistent with this finding.

**Judged by:** independent `backlog-gate-guard` semantic evaluator
**Judged at:** HEAD `e040f298fe53` · base `origin/develop@e040f298fe53` · document `.agents/spec-docs/backlog/INFRA-2772-bound-the-session-start-task-notice.md` blob `6304634566ea` (untracked)

### [GATE-APPROVAL] — ✅ PASS | 2026-09-20

**Status upgrade:** approved → approved
**Approval route:** `DIRECT`
**Instruction (verbatim):** "승인함"
**Given:** 2026-09-20, this conversation
**Review fingerprint:** b7b73e011ff1 (review d01ae4c6, type/tags f186cc84)

- GATE-APPROVAL — User has provided explicit approval in the current conversation: route DIRECT; `**Instruction (verbatim):**` recorded, given 2026-09-20, this conversation
- GATE-APPROVAL — The named class exists in the delegated-class registry, and its registry entry predates this approval. `backlo: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The authorising instruction is recorded verbatim, with its date and the session it was given in: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The class's stated evidence condition is shown to be met by measurement, not by assertion: route DIRECT, so the Route CLASS criterion does not apply
- GATE-APPROVAL — No Architecture Review or frontmatter type/tags modified after approval: the `**Review fingerprint:**` recorded at approval (b7b73e011ff1) equals the document's current fingerprint

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `e040f298fe53` · base `origin/develop@e040f298fe53` · document `.agents/spec-docs/todo/INFRA-2772-bound-the-session-start-task-notice.md` blob `c9be5f5ea238` (untracked)

### [GATE-APPROVAL] — ✅ PASS | 2026-09-21

**Status upgrade:** approved → approved
**Approval route:** `DIRECT`
**Instruction (verbatim):** "승인함"
**Given:** 2026-09-21, this conversation
**Review fingerprint:** 4ea8a5b3241e (review 797f1354, type/tags f186cc84)

- GATE-APPROVAL — User has provided explicit approval in the current conversation: route DIRECT; `**Instruction (verbatim):**` recorded, given 2026-09-21, this conversation
- GATE-APPROVAL — The named class exists in the delegated-class registry, and its registry entry predates this approval. `backlo: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The authorising instruction is recorded verbatim, with its date and the session it was given in: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The class's stated evidence condition is shown to be met by measurement, not by assertion: route DIRECT, so the Route CLASS criterion does not apply
- GATE-APPROVAL — No Architecture Review or frontmatter type/tags modified after approval: the `**Review fingerprint:**` recorded at approval (4ea8a5b3241e) equals the document's current fingerprint

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `e040f298fe53` · base `origin/develop@e040f298fe53` · document `.agents/spec-docs/todo/INFRA-2772-bound-the-session-start-task-notice.md` blob `d70e79ffceec` (untracked)

### [GATE-IMPLEMENT] — ✅ PASS | 2026-09-21

**Status upgrade:** approved → in-progress

- GATE-IMPLEMENT — ordering: prior gate GATE-APPROVAL PASS and status `approved`: [GATE-APPROVAL] — ✅ PASS | 2026-09-21; status `approved`
- GATE-IMPLEMENT — `.agents/tasks/<ID>.md` has been created: `## Tasks` names `.agents/tasks/INFRA-2772-bound-the-session-start-task-notice.md`, which exists
- GATE-IMPLEMENT — Tasks file path is recorded in the `## Tasks` section of the spec document: `## Tasks` names `.agents/tasks/INFRA-2772-bound-the-session-start-task-notice.md`, whose basename is the spec's
- GATE-IMPLEMENT — Tasks in the file correspond to the Completion Criteria (at minimum, one task per TC-N): Task names every TC id (4)
- GATE-IMPLEMENT — The tasks file includes a `## Test Plan` (or `## Testing` / `## 검증`) section with ≥50 chars — the `test-plans`: Task `## Test Plan` is 480 chars
- GATE-IMPLEMENT — The exact Task records a subject-bound user-execution PLAN terminal outcome: `not-applicable` includes the aut: Task `## User Execution Test Scenarios` records `SCENARIO DRAFTED: not-applicable | 0`
- GATE-IMPLEMENT — The whole worktree contains no staged, unstaged, untracked, renamed, or deleted path outside the exact paired : worktree inventory: 3 path(s), all within the paired spec/Task and .agents/loop-runs/

<!-- checkpoint-evidence:v2:start -->

```json
{
  "version": 2,
  "form": "gateImplementFirst",
  "deliveryMode": "single",
  "sequencedArtifacts": [],
  "taskPath": ".agents/tasks/INFRA-2772-bound-the-session-start-task-notice.md",
  "specPath": ".agents/spec-docs/todo/INFRA-2772-bound-the-session-start-task-notice.md",
  "taskItems": [
    {
      "kind": "tc-id",
      "value": "TC-01"
    },
    {
      "kind": "tc-id",
      "value": "TC-02"
    },
    {
      "kind": "tc-id",
      "value": "TC-03"
    },
    {
      "kind": "tc-id",
      "value": "TC-04"
    }
  ],
  "plan": {
    "outcome": "not-applicable",
    "count": 0
  },
  "worktreePaths": [
    ".agents/loop-runs/user-request-gate.jsonl",
    ".agents/spec-docs/todo/INFRA-2772-bound-the-session-start-task-notice.md",
    ".agents/tasks/INFRA-2772-bound-the-session-start-task-notice.md"
  ]
}
```

<!-- checkpoint-evidence:v2:end -->

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `e040f298fe53` · base `origin/develop@e040f298fe53` · document `.agents/spec-docs/todo/INFRA-2772-bound-the-session-start-task-notice.md` blob `73fc91d3f17b` (untracked)

### [GATE-COMPLETE: TC-01] — ✅ PASS | 2026-09-21

**Command:** `pnpm exec vitest run scripts/harness/__tests__/task-notice-is-bounded.test.mjs`
**Exit:** 0
**Output:** (last 10 of 10 line(s))

```
12:31:32 AM [vite] warning: `esbuild` option was specified by "vitest" plugin. This option is deprecated, please use `oxc` instead.

 RUN  v3.2.6 /Users/jungyoun/Documents/dev/woojubb/robota/.claude/worktrees/gracious-williams-b2f311

 ✓ scripts/harness/__tests__/task-notice-is-bounded.test.mjs (8 tests) 316ms

 Test Files  1 passed (1)
      Tests  8 passed (8)
   Start at  00:31:32
   Duration  469ms (transform 14ms, setup 0ms, collect 15ms, tests 316ms, environment 0ms, prepare 29ms)
```

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `9aad4d022aee` · base `origin/develop@e040f298fe53` · document `.agents/spec-docs/active/INFRA-2772-bound-the-session-start-task-notice.md` blob `40834b2d8b3f` (modified)

### [GATE-COMPLETE: TC-03] — ✅ PASS | 2026-09-21

**Command:** `pnpm exec vitest run scripts/harness/__tests__/remaining-hooks-run.test.mjs scripts/harness/__tests__/open-issues-are-shown.test.mjs`
**Exit:** 0
**Output:** (last 10 of 23 line(s))

```
   ✓ open issues are shown where the choice is made > bounds the LENGTH of one title, and says it did  352ms
   ✓ open issues are shown where the choice is made > does not let one issue fabricate a SECOND issue line  500ms
   ✓ open issues are shown where the choice is made > strips a CARRIAGE RETURN, which overwrites the line that labelled it  509ms
   ✓ open issues are shown where the choice is made > says so when the list is truncated  348ms
   ✓ open issues are shown where the choice is made > does NOT claim more when exactly the shown number are open  854ms

 Test Files  2 passed (2)
      Tests  32 passed (32)
   Start at  00:31:33
   Duration  10.32s (transform 27ms, setup 0ms, collect 41ms, tests 11.70s, environment 0ms, prepare 62ms)
```

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `9aad4d022aee` · base `origin/develop@e040f298fe53` · document `.agents/spec-docs/active/INFRA-2772-bound-the-session-start-task-notice.md` blob `7c1506fc2d7a` (modified)

### [GATE-COMPLETE: TC-04] — ✅ PASS | 2026-09-21

**Command:** `TASK_TRACKING_SKIP_ISSUES=1 bash .claude/hooks/task-tracking.sh start | tee /dev/stderr | wc -c`
**Exit:** 0
**Output:** (last 10 of 25 line(s))

```
  - API-001-map-model-effort-to-provider-capabilities-and-visible-outcomes.md — in progress
  - CLI-1994-fork-the-conversation-into-a-background-session.md — in progress
  - DIST-005-release-artifact-verification.md — in progress
  - HANDOFF-001-cross-device-session-transfer.md — in progress
  - HARNESS-024-live-provider-smoke.md — in progress
  - HARNESS-025-gate-hygiene-p3.md — in progress
  (showing the first 20 of 45 — the rest: ls .agents/tasks/)
Read the task file(s) before starting work. Update progress during the session.
[task-tracking] 122 todo Task(s) are not listed; choose work through the backlog, not this notice.
    1984
```

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `9aad4d022aee` · base `origin/develop@e040f298fe53` · document `.agents/spec-docs/active/INFRA-2772-bound-the-session-start-task-notice.md` blob `22d04d1a9712` (modified)

### [GATE-COMPLETE: TC-02] — ❌ FAIL | 2026-09-21

**Command:** `node scripts/harness/run-all-scans.mjs --affected --context pr --skip dist --skip build-contracts`
**Exit:** 1
**Output:** (last 10 of 269 line(s))

```
  evidence: Scan progress-report-quantification exited with status 1.
  recommendation: Inspect the progress-report-quantification scan output above.
ERROR harness.scan-finding.scan-c38-c2p-c37-c2z-c19-c31-c2t-c36-c2v-c2t-c2s-c19-c2r-c2x-c38-c2p-c38-c2x-c33-c32 [finding] scan:task-merged-citation
  evidence: Scan task-merged-citation exited with status 1.
  recommendation: Inspect the task-merged-citation scan output above.
ERROR harness.scan-finding.scan-c38-c2p-c37-c2z-c19-c2p-c36-c2r-c2w-c2x-c3a-c2p-c30 [finding] scan:task-archival
  evidence: Scan task-archival exited with status 1.
  recommendation: Inspect the task-archival scan output above.

2 of 72 scans failed
```

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `9aad4d022aee` · base `origin/develop@e040f298fe53` · document `.agents/spec-docs/active/INFRA-2772-bound-the-session-start-task-notice.md` blob `9d373dfa1fcc` (modified)

### [GATE-COMPLETE: TC-03] — ✅ PASS | 2026-09-21

**Command:** `pnpm exec vitest run hooks-run.test.mjs open-issues-are-shown.test.mjs`
**Exit:** 0
**Output:** (last 10 of 15 line(s))

```
   ✓ post-tool-format > reaches the extension filter, and the filter decides  379ms
 ✓ scripts/harness/__tests__/open-issues-are-shown.test.mjs (14 tests) 6966ms
   ✓ open issues are shown where the choice is made > reports them at session START  349ms
   ✓ open issues are shown where the choice is made > survives an unresponsive API, and says it could not ask  1045ms
   ✓ open issues are shown where the choice is made > uses its OWN 4s default, not the shared 10s one  4065ms

 Test Files  2 passed (2)
      Tests  32 passed (32)
   Start at  00:34:05
   Duration  7.13s (transform 28ms, setup 0ms, collect 41ms, tests 8.02s, environment 0ms, prepare 62ms)
```

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `9aad4d022aee` · base `origin/develop@e040f298fe53` · document `.agents/spec-docs/active/INFRA-2772-bound-the-session-start-task-notice.md` blob `ae73291022a6` (modified)

### [GATE-COMPLETE: TC-02] — ✅ PASS | 2026-09-21

**Command:** `node scripts/harness/run-all-scans.mjs --affected --context pr --skip dist --skip build-contracts`
**Exit:** 0
**Output:** (last 10 of 206 line(s))

```
Diagnostic report v1: 2 result(s), 2 non-clean.
ERROR harness.scan-finding.scan-c34-c36-c33-c2v-c36-c2t-c37-c37-c19-c36-c2t-c34-c33-c36-c38-c19-c35-c39-c2p-c32-c38-c2x-c2u-c2x-c2r-c2p-c38-c2x-c33-c32 [finding] scan:progress-report-quantification
  evidence: Scan progress-report-quantification exited with status 1.
  recommendation: Inspect the progress-report-quantification scan output above.
ERROR harness.scan-finding.scan-c38-c2p-c37-c2z-c19-c31-c2t-c36-c2v-c2t-c2s-c19-c2r-c2x-c38-c2p-c38-c2x-c33-c32 [finding] scan:task-merged-citation
  evidence: Scan task-merged-citation exited with status 1.
  recommendation: Inspect the task-merged-citation scan output above.

69 scans passed, 1 skipped, 2 advisory failure(s) tolerated (pr context), 2 non-clean diagnostic result(s) reported (72 declared what they examined)
scan receipt NOT written: 2 advisory failure(s) were tolerated (progress-report-quantification, task-merged-citation), and a receipt must not certify them.
```

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `9aad4d022aee` · base `origin/develop@e040f298fe53` · document `.agents/spec-docs/active/INFRA-2772-bound-the-session-start-task-notice.md` blob `ab4043ced0f5` (modified)

### [GATE-VERIFY] — ❌ FAIL | 2026-09-21

**Status remains:** in-progress
**Failed criteria:**

- GATE-VERIFY — Build passes for all affected packages (`pnpm build`): `node scripts/harness/run-all-scans.mjs --affected --context pr --skip dist --skip build-contracts` → exit 1 ( recommendation: Inspect the task-archival scan output above. ⏎ ⏎ 1 of 72 scans failed); `pnpm exec vitest run task-notice-is-bounded.test.mjs hooks-run.test.mjs open-issues-are-shown.test.mjs` → exit 0 ( Duration 6.44s (transform 36ms, setup 0ms, collect 60ms, tests 7.53s, environment 0ms, prepare 105ms) ⏎ ⏎ 12:35:32 AM [vite] warning: `esbuild` option was specified by "vitest" plugin. This option is deprecated, please use `oxc` instead.)
  **Required action:** make every verify command exit 0
- GATE-VERIFY — Tests pass for all affected packages (`pnpm test`): `node scripts/harness/run-all-scans.mjs --affected --context pr --skip dist --skip build-contracts` → exit 1 ( recommendation: Inspect the task-archival scan output above. ⏎ ⏎ 1 of 72 scans failed); `pnpm exec vitest run task-notice-is-bounded.test.mjs hooks-run.test.mjs open-issues-are-shown.test.mjs` → exit 0 ( Duration 6.44s (transform 36ms, setup 0ms, collect 60ms, tests 7.53s, environment 0ms, prepare 105ms) ⏎ ⏎ 12:35:32 AM [vite] warning: `esbuild` option was specified by "vitest" plugin. This option is deprecated, please use `oxc` instead.)
  **Required action:** make every verify command exit 0

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `9aad4d022aee` · base `origin/develop@e040f298fe53` · document `.agents/spec-docs/active/INFRA-2772-bound-the-session-start-task-notice.md` blob `e02bce9ad34e` (modified)

### [GATE-VERIFY] — ✅ PASS | 2026-09-21

**Status upgrade:** in-progress → verifying

- GATE-VERIFY — ordering: prior gate GATE-IMPLEMENT's last (and only) entry is `[GATE-IMPLEMENT] — ✅ PASS | 2026-09-21` (`approved → in-progress`); document `status: in-progress` in `.agents/spec-docs/active/`, which `spec-workflow.md` § Status and Lifecycle Folders maps `in-progress` to. The earlier `[GATE-VERIFY] — ❌ FAIL | 2026-09-21` is this gate's own prior run, not the prior gate's, and does not block a re-run.
- GATE-VERIFY — Every item in the `## Plan` section of `.agents/tasks/<ID>.md` is marked complete (`[x]`): `.agents/tasks/INFRA-2772-bound-the-session-start-task-notice.md` `## Plan` holds 8 checkboxes, 8 `[x]`, 0 `[ ]` (4 implementation items + TC-01..TC-04); `node scripts/harness/scan-task-plan-items.mjs` → exit 0 ("328 Task Plan sections … passed"). Ticks corroborated against the tree: `classify-dir` present in `scripts/harness/task-lifecycle.mjs` and called from `.claude/hooks/task-tracking.sh` (bound line at line 306), `scripts/harness/__tests__/task-notice-is-bounded.test.mjs` exists (8 tests, green), `.agents/skills/task-tracking/SKILL.md` modified (+6/−2). `gate.mjs` reported this criterion PENDING-GUARDIAN because its binding pattern reads the pre-#2375 wording ("All tasks in … are marked complete"), not because anything was undecided.
- GATE-VERIFY — No Plan item is blocked or pending: no Plan item is unticked, and none carries a blocked/pending disposition. The word "blocked" inside item 2 ("the bounded `in-progress`/`blocked` list") names the hook output the item implements, not the item's state; the item is `[x]`. No Plan item is a self-disposition (merge/land/close/publish).
- GATE-VERIFY — Build passes for all affected packages (`pnpm build`): scope is `scripts/**` + `.claude/hooks/**` with no package build, so the build-equivalent is the affected scan set. Re-run by the guardian: `node scripts/harness/run-all-scans.mjs --affected --context pr --skip dist --skip build-contracts --skip task-archival` → exit 0 ("68 scans passed, 1 skipped, 2 advisory failure(s) tolerated (pr context)"). The two advisories (`progress-report-quantification`: a session-transcript narrative line; `task-merged-citation`: SCREEN-2002's record) concern neither this document nor this Task. `task-archival` deferred deliberately: run alone (`node scripts/harness/check-task-archival.mjs` → exit 1) its sole finding is this Task, "all 8 checkbox(es) checked but the spec has not reached spec-docs/done/ — run GATE-VERIFY/GATE-COMPLETE, move the spec to done/, then archive"; the catalogue's GATE-COMPLETE "Post-PASS handoff" schedules that scan against the final state after the closing commit, so it cannot gate this transition.
- GATE-VERIFY — Tests pass for all affected packages (`pnpm test`): re-run by the guardian: `pnpm exec vitest run task-notice-is-bounded.test.mjs hooks-run.test.mjs open-issues-are-shown.test.mjs` → exit 0 — Test Files 3 passed (3), Tests 40 passed (40): `task-notice-is-bounded.test.mjs` 8, `remaining-hooks-run.test.mjs` 18, `open-issues-are-shown.test.mjs` 14.

**Judged by:** `backlog-gate-guard` semantic review with `gate.mjs` mechanical support.
**Judged at:** HEAD `9aad4d022aee` · base `origin/develop@e040f298fe53` · document `.agents/spec-docs/active/INFRA-2772-bound-the-session-start-task-notice.md` blob `caeba8586752` (modified)

### [GATE-COMPLETE] — ✅ PASS | 2026-09-21

**Status upgrade:** verifying → done

- GATE-COMPLETE — ordering: prior gate GATE-VERIFY PASS and status `verifying`: [GATE-VERIFY] — ✅ PASS | 2026-09-21; status `verifying`
- GATE-COMPLETE — The checkbox is checked (`[x]`): 4/4 TC checkboxes `[x]`
- GATE-COMPLETE — A `[GATE-COMPLETE: TC-N]` Evidence Log entry exists with: - The exact command or action used to verify - The a: a `[GATE-COMPLETE: TC-N]` entry with command/output exists for every TC (4)
- GATE-COMPLETE — **One of the following is recorded:** - **Test written:** test file path + test function/describe name (e.g., : every Test Plan row (4) carries a test reference or a skip reason
- GATE-COMPLETE — No TC-N is silently unaddressed — every row must have either a test reference or a skip reason: every Test Plan row (4) carries a test reference or a skip reason
- GATE-COMPLETE — Spec document `## Completion Criteria` checkboxes are all `[x]`: 4/4 TC checkboxes `[x]`
- GATE-COMPLETE — `## Test Plan` updated with test references or skip reasons for all TC-N rows: every Test Plan row (4) carries a test reference or a skip reason
- GATE-COMPLETE — The spec's `## Tasks` section names the exact active task path under `.agents/tasks/`: `## Tasks` names `.agents/tasks/INFRA-2772-bound-the-session-start-task-notice.md`, which exists
- GATE-COMPLETE — That active task exists and is completion-ready: all tasks are `[x]`, with no pending or blocked item: 8/8 tasks `[x]` in .agents/tasks/INFRA-2772-bound-the-session-start-task-notice.md

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `9aad4d022aee` · base `origin/develop@e040f298fe53` · document `.agents/spec-docs/active/INFRA-2772-bound-the-session-start-task-notice.md` blob `02b2590e3f38` (modified)
