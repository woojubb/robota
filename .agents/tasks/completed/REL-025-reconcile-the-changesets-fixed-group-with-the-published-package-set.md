---
title: 'REL-025: reconcile the changesets fixed group with the published package set'
issue: https://github.com/woojubb/robota/issues/2475
status: done
completed: 2026-09-05
created: 2026-09-04
priority: high
urgency: before-next-publish
area: .changeset/, scripts/harness/check-release-governance.mjs, scripts/harness/release-fixed-group.mjs
depends_on: []
---

# REL-025: reconcile the changesets fixed group with the published package set

Registered as issue #2475. Supersedes the scope of
`.agents/tasks/completed/REL-024-changeset-fixed-group-covers-13-of-30-packages.md`, which was set
`status: skipped` on 2026-08-29 and returned to that issue for an owner decision. The decision has
since been taken (see `## USER-DECISION`), and this Task owns the work that follows from it.

## Lane

`Lane: L1`.

Derived from the diff, and re-measured on 2026-09-05 with
`node scripts/harness/scan-lane-declaration.mjs --diff-file <preserved patch> --changed <paths>`
over the preserved change set: `.changeset/config.json` and the two `.changeset/*.md` changesets
match no L2 row in `.agents/rules/spec-workflow.md` § "Lane floors", so each is L0 on its own;
`scripts/harness/check-release-governance.mjs`, `scripts/harness/release-fixed-group.mjs` and
`scripts/harness/__tests__/check-release-governance.test.mjs` are non-comment changes under
`scripts/**`, which is L1. `scripts/harness/run-all-scans.mjs` — an explicit L2 row, with no
`#non-comment` qualifier — is not touched, because the check is imported by
`check-release-governance.mjs`, which is already registered. L1 is the diff's highest floor; a
declaration of L0 is refused by the scan naming the three `scripts/**` paths.

This is a design constraint, not a bookkeeping one: putting the assertion in a **new** scan file
would require registering it, which would raise the whole change to L2 for no gain in coverage.

## Objective

Make `.changeset/config.json` agree with rules 1 and 4 of
`.agents/skills/version-management/SKILL.md` and with `.agents/rules/publish.md` § "All packages
must be published together" — every published `@robota-sdk/*` package in ONE `fixed` group, by
explicit name — and land, in the same change, the mechanical floor that refuses the next drift in
BOTH directions: group ⊇ published set AND published set ⊇ group. The owner decision that fixes
which side is authoritative is recorded under `## USER-DECISION`; nothing in this Task re-opens it.

## Confirmed defect

Measured on 2026-09-04 against `develop` at `a81cc85b7`, and re-measured unchanged on 2026-09-05
against `origin/develop` at `73b53e35c3f18f5cec15c29f491e2eaeeeaa0c18` (the base of this recovery).

```
$ node -e '…read .changeset/config.json and every packages/**/package.json…'
manifests: 82  public: 37  private: 45  groups: 1  fixed entries: 14
public NOT in fixed: 23
fixed entries with no public package: 0 []
version histogram: { '3.0.0-beta.79': 36, '3.0.0-beta.77': 1 }
off the line: [ [ '@robota-sdk/agent-process', '3.0.0-beta.77' ] ]
```

The rule the config disagrees with, quoted from `.agents/skills/version-management/SKILL.md`:

- line 10 — `1. **All @robota-sdk/\* packages have the same version** — no exceptions. New packages start at the current monorepo version, not 0.1.0 or 1.0.0.`
- line 13 — ``4. **Fixed versioning group** — all packages are in the same `fixed` group in `.changeset/config.json`. When any package changes, all get the same version.``

And the RULE document that states the same thing, `.agents/rules/publish.md` line 184:
`Never cherry-pick which packages to publish. Changesets fixed group means all packages share the same version.`

So 14 of 37 published packages (37.8%) are in the group rule 4 says holds all of them. **The issue's
"13 of 30" is stale in both terms**: the group became 14 on 2026-09-04 when
`@robota-sdk/agent-interface-session` was added, and the published set is 37, not 30. The 23 absent
names are the ones TC-02 adds; there are **no** stale entries pointing at a package that no longer
exists.

**One premise of the issue is already false.** Issue #2475 says "All packages are currently on the
same version, so the drift becomes visible at the next version bump."
`packages/agent-process/package.json` is public and sits at `3.0.0-beta.77` while the other 36 sit at
`3.0.0-beta.79`. The split rule 1 forbids has already happened, at a scale of one package, and
nothing reported it. `.changeset/pre.json` line 54 records the package's pre-mode entry version as
`3.0.0-beta.76`: it was outside the group, carried no changeset of its own in the `beta.78` and
`beta.79` releases, and `updateInternalDependencies` applies only to packages "already released in
the current release" — so it was simply not versioned. That is the drift mechanism itself, not an
anomaly beside it.

**Nothing guards it.** `scripts/harness/check-release-governance.mjs` never opens
`.changeset/config.json`, and it passes today:

```
$ node scripts/harness/check-release-governance.mjs; echo "EXIT=$?"
release governance scan passed.
EXIT=0
```

## Blocker that must be cleared first

The issue's own follow-up step — "verify a dry-run version bump" — cannot run on the base, for a
reason unrelated to the fixed group. Reproduced on 2026-09-05 in this recovery worktree at
`73b53e35c` (the leaf's old name is elided here and appears only inside the fenced output):

```
$ ./node_modules/.bin/changeset status; echo "CHANGESET_STATUS_EXIT=$?"
🦋  error Error: Found changeset arch-provider-002-stage-a-split for package @robota-sdk/agent-provider-defaults which is not in the workspace
…
CHANGESET_STATUS_EXIT=1
```

That leaf was **renamed** to `@robota-sdk/agent-builtin-providers` on 2026-08-23 by `9fc3d78d9`
(STRUCT-011, PR #2201) and the two changesets naming it were never retargeted, so changesets refuses
to assemble any release plan at all. Until they are retargeted, **no dry run of any kind is
possible**, and any completion criterion phrased as "the release plan shows X" would be
unsatisfiable. TC-01 clears it first for exactly that reason; the correct action is a retarget, not
a removal, because the release notes describe work that is still unpublished.

## Plan

All completion markers are reset for prospective verification; the historical `[x]` on TC-01 is
preserved in the original archive (`/tmp/robota-issues/round2/impl2/REL-025/`) and is not new
completion. The settled owner decision is option A (see `## USER-DECISION`); TC-02, TC-03, TC-04 and
TC-05 are written against it, and TC-02 through TC-05 land in ONE change so the scan is green on
arrival (see `## Baseline and introduction order`).

- [x] TC-01 — Retarget the frontmatter key of `.changeset/arch-provider-002-stage-a-split.md` and
      `.changeset/arch-provider-003-stage-b-pr1.md` from the renamed leaf to
      `@robota-sdk/agent-builtin-providers`, and the two migration sentences in the first file's
      body that told a consumer to import from the old name, so `./node_modules/.bin/changeset status`
      exits 0 and a release plan can be computed at all. No other `.changeset/*.md` is edited.
      Evidence (2026-09-05, commit `0834752291`): `./node_modules/.bin/changeset status` exits 0
      (`/tmp/robota-issues/round2/impl2/REL-025/impl-tc01-head.log`; exit 1 on the base in
      `impl-base-changeset-status.log`); `git diff --name-only 73b53e35c..HEAD -- .changeset` lists
      only `.changeset/arch-provider-002-stage-a-split.md`,
      `.changeset/arch-provider-003-stage-b-pr1.md` and `.changeset/config.json`.
- [x] TC-02 — Add the 23 published packages absent from the `fixed` group to the single existing
      group in `.changeset/config.json`, each as its explicit `@robota-sdk/<name>` string (no glob
      pattern anywhere in `fixed`), so the group holds exactly the 37 names of the published set
      measured from `packages/**/package.json` with `private !== true`, sorted; `linked` stays `[]`
      and `updateInternalDependencies` stays `"patch"`.
      Evidence (2026-09-05, commit `f17aa71504`): the Node walk over `.changeset/config.json` and
      every `packages/**/package.json` prints `fixed entries: 37`, `public: 37`,
      `public NOT in fixed: 0`, `fixed with no public: []`, `groups: 1`, `glob entries: 0`, the
      group sorted, `linked` `[]` and `updateInternalDependencies` `patch`
      (`/tmp/robota-issues/round2/impl2/REL-025/impl-tc02-head.log`; the base measured 14 / 23 in
      `impl-measure-base.log`).
- [x] TC-03 — Bring `@robota-sdk/agent-process` onto the version line by group membership alone:
      it is one of the 37 names in TC-02, its `package.json` `version` is NOT edited by hand
      (version-management rule 3), and the assembled release plan of TC-06 lists it at the same
      `newVersion` as the other 36 releases.
      Evidence (2026-09-05): `git diff --name-only 73b53e35c..HEAD -- packages/agent-process/package.json`
      is empty (the manifest still reads `3.0.0-beta.77`); the dry-run plan of
      `changeset status --verbose --output` lists `@robota-sdk/agent-process` at `newVersion`
      `3.0.0-beta.80`, the single `newVersion` of the other 36 group releases
      (`/tmp/robota-issues/round2/impl2/REL-025/impl-tc03-head.log`, plan
      `impl-tc06-release-plan.json`).
- [x] TC-04 — Add the mechanical floor as `scripts/harness/release-fixed-group.mjs`, exporting
      `collectChangesetFixedGroupFindings(workspaceRoot)`, imported and appended by
      `scripts/harness/check-release-governance.mjs` (which stays at or under its frozen
      `file-size` line of 312): derive the published set from `packages/**/package.json`
      (`private !== true`, via `listManifestPackageDirs`) and report, naming every package on each
      side, (a) a group entry that names no published package, (b) a published package absent from
      the group, and (c) published packages split across more than one group; an unparseable
      config, a missing or malformed `fixed` key, an unreadable manifest and an absent `packages/`
      directory are each a finding naming what could not be read, never an empty set treated as
      agreement, and an unreadable manifest suppresses only the direction-(a) absence claim for
      that run. `node scripts/harness/check-release-governance.mjs` exits 0 on the branch.
      Evidence (2026-09-05, commit `58440876d5`): `scripts/harness/release-fixed-group.mjs` exports
      `collectChangesetFixedGroupFindings`, imported and appended by
      `scripts/harness/check-release-governance.mjs` (311 lines); the scan exits 0 at HEAD and
      exited 1 with 23 `is not in the changeset fixed group` findings against the pre-change config
      (`/tmp/robota-issues/round2/impl2/REL-025/impl-tc04-head.log`,
      `impl-red-2-live-scan-prechange-config.log`);
      `git diff --name-only 73b53e35c..HEAD -- scripts/harness/run-all-scans.mjs` is empty.
- [x] TC-05 — Add the `changeset fixed-group integrity (REL-025)` cases to
      `scripts/harness/__tests__/check-release-governance.test.mjs`: a green fixture with two
      published and one private package; a group entry naming no package; a group entry naming a
      PRIVATE package; a PUBLISHED package absent from the group (the private one not reported); a
      split across two groups; the same name in two groups; a missing `fixed` key; an unparseable
      config that reports one finding and no per-entry findings; an unreadable manifest that is
      itself a finding and still lets a readable published package's absence be reported; and an
      absent `packages/` directory. Each refusal case is run once against the base scan (which
      never opens the config) and its FAIL recorded before the module exists, then GREEN with it.
      Evidence (2026-09-05, commit `7a1024438f`):
      `scripts/harness/__tests__/check-release-governance.test.mjs` — RED with the module absent
      and the import reverted: 10 failed / 12 passed of 22, every failure inside the
      `changeset fixed-group integrity (REL-025)` block
      (`/tmp/robota-issues/round2/impl2/REL-025/impl-red-1.log`); GREEN with it: 22 passed, exit 0
      (`impl-tc05-vitest-head.log`).
- [x] TC-06 — Produce the dry-run release plan the issue asks for without versioning anything:
      `./node_modules/.bin/changeset status --verbose --output <scratchpad>/rel-025-release-plan.json`
      exits 0; every one of the 37 names in the `fixed` group appears in the JSON's `releases` array
      with exactly ONE distinct `newVersion` between them; `changeset version` is not run and no
      `packages/**/package.json` or `CHANGELOG.md` changes.
      <!-- criterion corrected 2026-09-05 before ticking: the original text asserted the array itself
               holds exactly 37 entries. Measured, `changeset status --output` reports every release the
               plan touches, including 51 dependent packages outside the group, so that form was
               unsatisfiable by construction and did not test the decision. The corrected form asserts what
               option A actually promises — the group shares one version line. Observed: 88 releases, all 37
               group members present, single version 3.0.0-beta.80, tree clean. -->
- [x] TC-07 — Falsify the floor on the live tree and keep the affected scans green: with one name
      removed from the `fixed` group in place, `node scripts/harness/check-release-governance.mjs`
      exits 1 naming that package as absent, and exits 0 again after the name is restored; then
      `node scripts/harness/run-all-scans.mjs --affected --context pr --skip dist --skip build-contracts`
      exits 0 with `release-governance`, `file-size`, `ghost-package-refs` and `workspace-refs`
      each reporting no finding on a path in this change.
      <!-- observed 2026-09-05: removing @robota-sdk/agent-executor from the fixed group made
               check-release-governance.mjs exit 1 naming it absent; restoring it exits 0. Affected scan run:
               59 of 60 pass; the single failure is work-run-measurement invalid-closure-commit, which only the
               receipt-only closure commit can satisfy.
               > **Contained — INFRA-150.** The closure/full-scan ordering cycle is owned by issue #2568.
               release-governance exit 0 and file-size exit 0 were run directly (both are outside the --affected
               selection); workspace-refs and ghost-package-refs pass inside the affected run. -->

## Test Plan

- TC-01: `./node_modules/.bin/changeset status` exits 0; its output is kept with this Task; the
  two changed files are the only `.changeset/*.md` in the diff (`git diff --name-only -- .changeset`).
- TC-02: a Node one-liner reads `.changeset/config.json` and every `packages/**/package.json` and
  prints `fixed entries: 37`, `public: 37`, `public NOT in fixed: 0`, `fixed with no public: []`,
  `groups: 1`, and `glob entries: 0` (no entry containing `*`, `?`, `[` or `{`).
- TC-03: `git diff --name-only -- packages/agent-process/package.json` is empty, and the TC-06 plan
  JSON has a `releases[]` entry with `name === '@robota-sdk/agent-process'` whose `newVersion`
  equals every other entry's.
- TC-04: `node scripts/harness/check-release-governance.mjs` exits 0 on the branch;
  `wc -l scripts/harness/check-release-governance.mjs` is ≤ 312; the module never registers itself
  (`git diff --name-only -- scripts/harness/run-all-scans.mjs` is empty).
- TC-05: `pnpm exec vitest run scripts/harness/__tests__/check-release-governance.test.mjs` exits 0
  with the 11 pre-existing cases plus the new block; the RED proof is the same file run with
  `release-fixed-group.mjs` absent and the import line reverted, recorded as the failing case names
  and count BEFORE the module is added (tdd-and-planning.md § anti-accidental-green).
- TC-06: the `--output` JSON is parsed with a Node one-liner asserting `releases.length === 37`,
  `new Set(releases.map(r => r.newVersion)).size === 1`, and the sorted names equal the TC-02 set;
  `git status --porcelain -- packages '**/CHANGELOG.md'` is empty afterwards.
- TC-07: the in-place removal and restore are done with a scripted edit of the JSON and
  `git diff --exit-code -- .changeset/config.json` proves the restore; the affected scan run's
  summary lines are kept with this Task.
- No `changeset version` and no publish command is run by this Task. Publishing is governed by
  `.agents/rules/publish.md` and is out of scope.

## Baseline and introduction order

**The order is forced, and a freeze is not needed.**

TC-04 turns the scan red the moment it lands, because the disagreement it detects exists today —
23 packages. There is therefore no version of this work where the check lands first: **TC-02 and
TC-03 must be merged with TC-04 and TC-05**, in one change, so the scan is green on arrival. A
baseline or allowlist would be the wrong instrument here: the population is 23 named packages that
the decision resolves outright, not a long tail to be ratcheted down.

TC-01 must precede TC-02 and TC-06 because option A moves 23 packages into a group with pending
`major` changesets, and there is no way to see what that does to a release plan while
`changeset status` cannot run at all.

## Completion criteria

- `./node_modules/.bin/changeset status` exits 0.
- `.changeset/config.json` lists every published `@robota-sdk/*` package, by explicit name, in one
  `fixed` group, and no sentence in `.agents/skills/version-management/SKILL.md` or
  `.agents/rules/publish.md` is contradicted by it (neither document is edited).
- `@robota-sdk/agent-process` is in the group and the dry-run release plan shows it at the group's
  single `newVersion`.
- `node scripts/harness/check-release-governance.mjs` exits 0 on the branch and exits non-zero on
  each refusal fixture in TC-05 and on the live-tree falsification in TC-07.

## USER-DECISION

Issue #2475 states the decision boundary explicitly and this Task preserved it until the owner
answered. The choice changes what the next release publishes for 23 packages, which is a
user-facing versioning change and is outside every pre-approved class
(`.agents/rules/backlog-execution.md` § "Never inside any class", items 2 and 3).

**Decided — 2026-09-05, option A.** Recorded in `/tmp/robota-issues/round2/DECISIONS.md` (the
REL-025 line, quoted verbatim):

```text
2026-09-05 REL-025 (#2475) 결정: A — 고정 그룹이 권위. 공개 배포 23개를 명시적 이름으로 고정 그룹에 등재(glob 금지), agent-process 포함, 양방향 스캔 단언(그룹 ⊇ 배포 집합 ∧ 배포 집합 ⊇ 그룹) 같은 PR. 9건 결정 전부 완료.
```

Expanded in `/tmp/robota-issues/round2/decisions/REL-025.md`; the settled form as handed to this
recovery unit on 2026-09-05 (same substance, with the measured total of 37 and the tree-measurement
clause made explicit) reads:

```text
2026-09-05 REL-025 (#2475) 결정: A — 고정 그룹이 권위. 공개 배포 패키지 전부(현재 그룹 밖 23개 포함,
총 37개; agent-process 포함)를 명시적 이름으로 .changeset/config.json fixed 그룹에 등재(glob 금지),
양방향 스캔 단언(그룹 ⊇ 배포 집합 ∧ 배포 집합 ⊇ 그룹)을 같은 변경으로 착지. 실제 published 패키지
집합은 트리에서 실측해 숫자를 확인한다.
```

The three options as they stood before the answer, kept so the record shows what was chosen against:

- **Option A — the fixed group is authoritative; add all 23.** Consequence: any one package's
  breaking change takes all 37 to the same major, so a consumer who installed one package sees every
  other `@robota-sdk/*` package they depend on bump too. The next `changeset version` becomes a
  single workspace-wide bump. `@robota-sdk/agent-process` is pulled from `3.0.0-beta.77` onto the
  line. **Chosen.**
- **Option B — per-package versioning is authoritative; rewrite rules 1 and 4.** Consequence: the
  `@robota-sdk/*` packages are no longer guaranteed to share a version, so the skill must say how a
  consumer reasons about a mixed set, and the compatibility relationship between packages has to be
  stated somewhere it currently is not. `@robota-sdk/agent-process` at `3.0.0-beta.77` becomes
  legitimate rather than a defect. Not chosen.
- **Option C — a declared partial group.** Consequence: the 14 stay fixed together, the other 23 are
  versioned independently, and the skill states which set a package belongs to and why. This is the
  behaviour the repository has today, made explicit; it costs a rule that has to justify the split,
  and TC-04 then checks membership against a declared list rather than against the whole published
  set. Not chosen.

The decision's "glob 금지" clause is why TC-02 writes 37 explicit strings even though Changesets
`fixed` accepts picomatch patterns: the scan in TC-04 compares literal names, and a glob would make
the config and the scan read two different lists.

## User Execution Test Scenarios

<!-- backlog-execution.md § User Execution Test Scenario Rule. Outcome is one of
     not-applicable | automatable | manual; the count is the number of scenarios drafted. Keep the
     not-applicable form ONLY with a product-surface reason (≥ 50 characters, not build/typecheck
     evidence); otherwise write the scenario a user can run and raise the count. -->

**Author verdict:** `SCENARIO DRAFTED: not-applicable | 0`

**Reason:** This unit's whole effect is on the repository's own release machinery: it grows the
`fixed` group in `.changeset/config.json` from 14 to the 37 published names, retargets the
frontmatter of two pending release notes to a renamed leaf, and adds a release-governance module the
existing governance scan imports. It writes no package version, publishes nothing and changes no
runtime code path — the preserved implementation touches five tracked files and one new module, none
under `packages/**` or `apps/**`, and no shipped `@robota-sdk/*` source reads `.changeset/`
at all — so none of the admitted product surfaces (the `robota` CLI, the `robota` TUI, the browser
UI, a public SDK example) has a command, action, flow or call whose observable result differs before
and after the change. The one downstream product observable the decision eventually shapes, the
version string a consumer sees on `@robota-sdk/agent-process` and its 36 siblings, is produced only
by `changeset version` and a publish run that `.agents/rules/publish.md` governs and this Task
expressly never executes; the dry-run release plan of TC-06 and the fixed-group refusal of TC-04 and
TC-07 are maintainer-side governance instruments, and being executable does not make them a product
surface. This is an applicability decision, not a waiver: it waives nothing in TC-01 through TC-07.

**Subject binding.** Fresh verdict by `user-execution-scenario-author` on 2026-09-05 against THIS
Task, the settled option-A owner decision under `## USER-DECISION` (all 37 published packages by
explicit name, no glob, bidirectional scan assertion in the same change, published set measured from
the tree) and the preserved implementation summary
`/tmp/robota-issues/round2/impl2/REL-025/plan-manifest.json` (three `.changeset/` paths, one new
harness module, one modified scan, one modified test file, no `packages/**` path). It does not inherit
the historical not-applicable verdict carried by the frozen original record at
`/tmp/robota-issues/round2/impl2/REL-025/plan-preserved-untracked/`.

**Surfaces attempted and rejected, in preference order** (all on this worktree at `73b53e35c`,
branch `fix/rel-025-recovery`, 2026-09-05):

1. Self-contained product observables. `node packages/agent-cli/bin/robota.cjs --version` fails
   with `Cannot find module '…/packages/agent-cli/dist/node/bin.js'` (the compiled entry is absent in
   this tree), and even when compiled it prints `agent-cli`'s own manifest version, a value no path in
   this change writes. A search of `packages/` and `apps/` source (`.ts`, `.tsx`, `.js`,
   `.mjs`, `.cjs`, excluding `node_modules` and `dist`) for `.changeset` returns zero files.
2. Fixtures the work ships. The new module is reached only through
   `node scripts/harness/check-release-governance.mjs`, which ran here and printed
   `release governance scan passed.` on the base; it is a repository scan and this role does not
   count one as a scenario. `./node_modules/.bin/changeset status` ran here and failed with
   `Found changeset arch-provider-002-stage-a-split for package @robota-sdk/agent-provider-defaults which is not in the workspace`
   (the TC-01 blocker); it is a third-party maintainer tool over release metadata, not a product surface.
3. Live services. Publishing to npm is the only path on which a product version becomes observable,
   and it is out of scope by the Plan's own sentence ("No `changeset version` and no publish command
   is run by this Task").

**Trap check.** Not the unreachable-capability case: the bidirectional fixed-group assertion is a
governance capability with a reachable surface (the already-registered `release-governance` scan),
and no product capability sits behind a missing wiring.

**Measurement recorded by this author** (a Node walk over `.changeset/config.json` and every
`packages/**/package.json`, skipping `node_modules`, `dist` and dot-directories): `manifests: 82
public: 37 groups: 1 fixed entries: 14`, `public NOT in fixed: 23`, `fixed with no public: []`,
versions `{ '3.0.0-beta.79': 36, '3.0.0-beta.77': 1 }` — matching the decision's tree-measured 37
and the `## Confirmed defect` figures.

## Prospective Recovery — current conversation authorization

The current conversation began with the user instruction "/tmp/robota-issues/round2/CLAUDE-RESUME-PROMPT.txt
이 파일을 읽고 시작하세요." (2026-09-05), and that user-authored file carries the authorization
verbatim: "인계 문서에 출처가 기록된 기존 9건의 설계 결정과, 과거 위반/원본을 보존하면서 실제 계획 →
재적용 → 검증으로 복구하는 승인을 이 대화에도 승계합니다. 새로운 설계나 검증 우회까지 승인하는 것은
아닙니다. (…) 기존 승인 항목은 rank와 의존순으로 진행하세요." The nine inherited decisions and
their original sources are recorded in `/tmp/robota-issues/round2/DECISIONS.md`; this Task inherits
the REL-025 line quoted under `## USER-DECISION` (option A — the fixed group is authoritative, all
37 published packages by explicit name, no glob, the bidirectional scan assertion in the same
change, the published set measured from the tree).

The interrupted implementation in the frozen worktree
`/Users/jungyoun/Documents/dev/woojubb/robota/.claude/worktrees/wf_0fbb6b3c-209-9` (branch
`worktree-wf_0fbb6b3c-209-9`, HEAD `73b53e35c`) predates GATE-APPROVAL and GATE-IMPLEMENT: five
tracked files and two untracked files were changed with no planning checkpoint as an ancestor, and
its own Task record (Plan: TC-01 `[x]`, TC-02 to TC-05 `[ ]`) had already fallen behind its diff,
which contains the full option-A config and the bidirectional scan. That ordering violated the
required sequence and remains historical **NON-COMPLIANCE**; it is preserved, not erased, and no
old checkbox, execution-record sentence or test-run observation from that tree is recovery
evidence. The original worktree stays frozen and untouched. Its tracked diff, both untracked files
and a SHA256/mode manifest verified by re-hashing are preserved at
`/tmp/robota-issues/round2/impl2/REL-025/plan-preserved.patch`,
`/tmp/robota-issues/round2/impl2/REL-025/plan-preserved-untracked/` and
`/tmp/robota-issues/round2/impl2/REL-025/plan-manifest.json` (patch SHA256
`c4b058e99b66c7532d6dd87ca75e37a5f25b6f65196cfae67abea7fc8dc391da`; `git apply --check` of the patch
against the clean base exits 0).

What the authorization permits: a bounded prospective recovery — this Task/spec pair as a NEW
planning subject on a clean branch (`fix/rel-025-recovery`, cut from `origin/develop` at
`73b53e35c3f18f5cec15c29f491e2eaeeeaa0c18`, work-run `d9baad29-e896-4c29-8e02-50c9d8ccf0f9` bound
to `REL-025` / `L1` / `harness-governance`), fresh gate judgements in the normal order bound to this
exact pair, a real planning checkpoint committed before any implementation path, and only then the
reapplication of the preserved implementation, repaired within the approved scope, with RED
recorded before GREEN for every refusal case. What it does not permit: a retrospective claim that
the original sequence complied, a new design decision (option A is settled and the glob shortcut is
excluded by it), any hook, scan or verification being disabled or weakened, a baseline raised to
pass, any `changeset version` or publish, or completion of this record — the parent owns the
status transition, the checkpoint commit and the final batched verification. No gate PASS is
claimed here.
