---
status: done
type: INFRA
tags: [cli, typescript]
completed: 2026-08-14
---

# INFRA-089: Staged auto-fix before commit

## Problem

Robota already runs `eslint --fix` and `prettier --write` from lint-staged inside the Husky pre-commit
hook, but the same operation has no discoverable root script for developers to run deliberately after
development and before final verification. The closest root command, `pnpm lint:fix`, only covers
TypeScript/TSX under `packages` and `apps`; it does not provide the commit-scoped JavaScript, Markdown,
JSON, and YAML formatting already configured in `.lintstagedrc.json`.

As a result, auto-fixes can first appear during `git commit`, after tests were run, and the documented
development-completion workflow does not establish that verification must inspect the post-fix tree.
There is also no one-shot command for the owner's occasional deliberate normalization of every file in
the repository-supported ESLint and Prettier scopes.

## Prior Art Research

Research date: 2026-08-13. Scope was limited to official documentation for the four tools already
installed in Robota.

| Tool               | Official source                                                                                     | Relevant behavior                                                                                                                                                                                                                             |
| ------------------ | --------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| lint-staged 15.5.2 | <https://github.com/lint-staged/lint-staged/tree/v15.5.2>                                           | Runs tools only against staged files. Array tasks execute sequentially; the documented safe order is `eslint --fix` followed by `prettier --write`. Successful changes are automatically staged, and a backup stash protects partial staging. |
| Husky              | <https://typicode.github.io/husky/get-started.html>, <https://typicode.github.io/husky/how-to.html> | `.husky/pre-commit` is the standard commit-time entrypoint. Hooks remain bypassable through `--no-verify` or `HUSKY=0`, so CI checks remain necessary.                                                                                        |
| ESLint             | <https://eslint.org/docs/latest/use/command-line-interface#--fix>                                   | `--fix` writes available safe fixes but cannot repair every finding. A later lint or verification pass is still required.                                                                                                                     |
| Prettier           | <https://prettier.io/docs/precommit>, <https://prettier.io/docs/install.html#git-hooks>             | Recommends lint-staged when combined with ESLint or partial staging. Its installation guide places ESLint before Prettier. Ignore behavior remains owned by `.prettierignore`.                                                                |

Robota already has the recommended underlying structure: `.lintstagedrc.json` applies ESLint before
Prettier to staged JS/TS and Prettier to staged data/document files; `.husky/pre-commit` runs lint-staged
under `scripts/harness/with-repo-lock.sh`. The lock is a repository-specific requirement because
lint-staged's backup uses clone-shared `refs/stash`, and INFRA-082 recorded concurrent-worktree backup
damage without serialization. `.claude/hooks/post-tool-format.sh` intentionally runs only Prettier per
edit and defers ESLint to commit time.

The common pattern and Robota's constraint therefore support exposing the existing locked staged-only
operation for routine commits. A separate, explicitly invoked whole-tree command can serve occasional
repository normalization without putting broad mutation on every commit.

## Architecture Review

### Affected Scope

- Root developer-command surface: `package.json`
- Git commit safety net: `.husky/pre-commit`
- Existing lint-staged policy: `.lintstagedrc.json` (verified as canonical; no behavior change expected)
- Change-completion workflow owner: `.agents/skills/post-implementation-checklist/SKILL.md`
- Harness tests for hook/script wiring under `scripts/harness/__tests__/`

### Placement and Product-Family Classification

The closest structural analog is the root developer-command family already exposed by `package.json`:
`lint`, `lint:fix`, `harness:scan`, `harness:test`, and `harness:verify-like-ci`. These commands compose
repository-local quality tools and `scripts/harness/*`; they are INFRA/developer-workflow entrypoints, not
the shipped `robota` product CLI, an application presentation surface, or a workspace package public API.
Accordingly, `lint:fix` and `lint:fix:staged` belong beside those root scripts rather than under a product package.

The implementation reuses the lowest existing shared mechanisms: `.lintstagedrc.json` owns staged-file
tool selection/order, `.eslintignore` and `.prettierignore` own full-sweep scope exclusions, and
`scripts/harness/with-repo-lock.sh` owns cross-worktree serialization. `.husky/pre-commit` remains a thin
Git adapter that calls the root developer command. No sibling product (`packages/agent-cli`, an app, or
another deployable) is imported, wrapped, or depended upon.

### Alternatives Considered

1. Make a whole-repository `eslint --fix && prettier --write .` command mandatory at pre-commit.
   - Pro: every commit normalizes all supported files regardless of staging state.
   - Con: it is slow and mutates unrelated dirty files on every commit; root `lint:fix` and formatter
     scopes also differ, making this broader than the intended commit.
2. Keep only the current pre-commit invocation.
   - Pro: no repository change and every ordinary commit already receives auto-fixes.
   - Con: fixes first appear during commit, after verification, and the operation remains undiscoverable
     as an explicit development-completion step.
3. Expose two explicit commands under the existing `lint:fix` namespace: the locked staged-only operation for routine commits and a
   separate manually invoked whole-tree fixer for occasional normalization; have pre-commit use only the
   staged command.
   - Pro: staged-only mutation preserves unrelated work during normal commits, while the owner still has
     an intentional full-sweep command; one staged entrypoint prevents hook/script drift.
   - Con: the developer must choose the correct command and a full sweep can create a large review diff.

### Decision

Choose alternative 3. Extend the existing root `lint:fix` command from ESLint-only correction to the full
repository quality-fix operation: run ESLint auto-fix over the canonical lint scope (`packages` and
`apps`), then run Prettier over the repository root while respecting `.eslintignore` and
`.prettierignore`. Add `lint:fix:staged` to execute the existing lint-staged configuration through the
existing clone-wide repository lock. The root `lint:fix:staged` command owns exactly one lock invocation;
`.husky/pre-commit` preserves its memory setting and protected-branch/lesson guards, then delegates to that
root command without wrapping it in a second lock. Record the routine order as
`stage intended paths → pnpm lint:fix:staged → affected verification → commit`; the hook repeats the staged
fixer as a final safety net. Document `pnpm lint:fix` as an intentional occasional full sweep whose result
must be reviewed and verified before it is staged.

Keep `.lintstagedrc.json` ordering unchanged (`eslint --fix` then `prettier --write`) and rely on
lint-staged's automatic restaging. Do not add `git add`, do not weaken non-fixing lint/CI verification, and
do not make the whole-tree mutating command part of pre-commit.

This is an augmentation of the existing commit-quality mechanism, not a new enforcement layer. Every
consumer is reachable through the root pnpm script, and the existing hook retains its repository lock.
The principal failure modes—unrelated-file mutation, partially staged changes, concurrent worktree stash
collision, and hook bypass—are respectively addressed by staged-only scope, lint-staged's backup behavior,
the retained lock, and unchanged verification/CI.

Placement validation: the root-script analog is reachable both interactively through `pnpm` and from the
Husky adapter; the whole-tree command retains the current `lint:fix` capability and adds Prettier rather
than replacing either tool contract; adversarial review rejects placing broad mutation in pre-commit and
rejects importing a product CLI merely to expose a developer-only command.

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료
- [x] Sibling scan 완료 — root scripts, lint-staged config, Husky pre-commit, per-edit formatter hook, and completion workflow inspected
- [x] 대안 최소 2개 검토 완료
- [x] 결정 근거 문서화 완료

## Fallback & Degradation Declaration

None

## Solution

1. Add `pnpm lint:fix:staged` as the visible owner of the locked lint-staged invocation.
2. Extend manually invoked `pnpm lint:fix` to run the canonical full ESLint scope followed by repository-wide
   Prettier formatting under the canonical ignore files.
3. Route `.husky/pre-commit` through `pnpm lint:fix:staged` without changing its preceding guards or memory
   setting. Remove the hook-local lock wrapper because the root command is the single lock owner.
4. Add the explicit pre-commit sequence to the existing change-completion workflow owner: stage intended
   paths, run `pnpm lint:fix:staged`, then verify the resulting tree before commit.
5. Add a mechanical test that fails if either root command, repository lock, hook delegation, or
   ESLint-before-Prettier ordering drifts.
6. Do not retain a whole-tree sweep while earlier functional work remains unmerged. First ship this
   command infrastructure and the current functional branch through develop and main. Then run
   `pnpm lint:fix` from a fresh branch based on the updated integration head, review its full diff, and
   verify idempotence there. Apply `pnpm lint:fix:staged` before each commit.

## Affected Files

- `package.json`
- `.husky/pre-commit`
- `.lintstagedrc.json` (mechanically asserted, expected unchanged)
- `.eslintignore` and `.prettierignore` (canonical scope inputs, expected unchanged)
- `.agents/skills/post-implementation-checklist/SKILL.md`
- `scripts/harness/__tests__/staged-auto-fix.test.ts` (exact location to follow existing harness-test layout)

## Completion Criteria

- [x] TC-01: `pnpm lint:fix:staged` with staged malformed TS/JS and Markdown fixtures exits 0, applies ESLint before Prettier where applicable, and leaves unrelated unstaged fixtures byte-identical.
- [x] TC-02: the `pnpm lint:fix` command contract applies ESLint fix to the canonical full lint scope and then Prettier to the repository root under canonical ignore files; actual whole-tree execution is deferred to a fresh post-promotion normalization branch so it cannot obstruct earlier feature merges.
- [x] TC-03: `.husky/pre-commit` invokes the root `lint:fix:staged` command, never full `lint:fix`, while preserving the clone-wide repository lock and all existing guards.
- [x] TC-04: a harness test fails against a fixture that removes either command, hook delegation, the lock, or reverses ESLint/Prettier order, and passes against the repository configuration.
- [x] TC-05: the canonical change-completion workflow states `stage → pnpm lint:fix:staged → verify → commit`, documents `pnpm lint:fix` as an occasional reviewed full sweep, and `pnpm harness:scan` exits 0.
- [x] TC-06: the attempted current-tree full sweep is reverted exactly to its pre-run dirty-path baseline; current intended paths pass `pnpm lint:fix:staged` and affected verification runs afterward; a dependent normalization work item records the post-main execution.

## Test Plan

| TC-ID | Test Type              | Tool / Approach                                                                                                                                                                                                                                                                                                   | Notes                                                                                                                                                                 |
| ----- | ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TC-01 | CI pipeline smoke test | `scripts/harness/__tests__/staged-auto-fix.test.mjs` — `fixes only staged source and documentation files and automatically re-stages them`                                                                                                                                                                        | Temporary Git fixture checks exact mutations, staged paths, and unrelated bytes.                                                                                      |
| TC-02 | CI pipeline smoke test | `scripts/harness/__tests__/staged-auto-fix.test.mjs` > `INFRA-089 staged and full auto-fix contract` > `the live repository has one staged fixer, one optional full fixer, and post-fix verification`; plus `.agents/tasks/completed/INFRA-090-post-promotion-whole-repository-format-normalization.md`           | Contract ordering plus durable full-sweep convergence/promotion evidence.                                                                                             |
| TC-03 | CI pipeline smoke test | `scripts/harness/__tests__/staged-auto-fix.test.mjs` live-contract case; `scripts/harness/__tests__/worktrees-share-the-stash.test.mjs` — `the pre-commit hook reaches the lock through the root staged-fix command`                                                                                              | Verifies hook delegation and exactly one lock owner.                                                                                                                  |
| TC-04 | CI pipeline smoke test | `scripts/harness/__tests__/staged-auto-fix.test.mjs` table `rejects %s`                                                                                                                                                                                                                                           | Mutation cases cover missing command/lock, broad hook use, and reversed ordering.                                                                                     |
| TC-05 | CI pipeline smoke test | `scripts/harness/__tests__/staged-auto-fix.test.mjs` > `INFRA-089 staged and full auto-fix contract` > `the live repository has one staged fixer, one optional full fixer, and post-fix verification`; plus `pnpm harness:scan`                                                                                   | Verifies the workflow owner and full harness registration.                                                                                                            |
| TC-06 | CI pipeline smoke test | Automated test skipped: rollback equality, cross-branch normalization, PR promotion, and branch removal are historical Git/CI operations that cannot be safely replayed by a repository unit test. Durable evidence: `.agents/tasks/completed/INFRA-090-post-promotion-whole-repository-format-normalization.md`. | The staged-workflow contract remains covered by `scripts/harness/__tests__/staged-auto-fix.test.mjs`; the one-time operational transition is evidenced, not replayed. |

## Tasks

- [x] `.agents/tasks/completed/INFRA-089-staged-auto-fix-before-commit.md` — TC-01 through TC-06 implementation and verification

## Evidence Log

### [GATE-WRITE] — ❌ FAIL | 2026-08-13

**Status remains:** draft
**Failed criteria:**

- New-surface placement (conditional): The document explicitly introduces a new root developer-command/interface surface (`fix:staged` and `fix`) and lists inspected siblings, but the Sibling scan and Decision do not name the analogous existing layer together with its product-family classification, nor explicitly demonstrate that reuse occurs at the shared contract/core level rather than through a sibling PRODUCT dependency.
  **Required action:** In Architecture Review, identify the analogous existing command layer and its product-family classification, and state with concrete dependency evidence that the new commands reuse the repository-owned shared configuration/entrypoint rather than depending on a sibling PRODUCT; then re-run GATE-WRITE.

### [GATE-WRITE] — ✅ PASS | 2026-08-13

**Status upgrade:** draft → review-ready

- Frontmatter: valid YAML block contains `status: draft`, allowed type `INFRA`, and non-empty `tags`.
- Problem: identifies the missing discoverable pre-verification and whole-tree commands, the commit-time reproduction point, and concrete current scope mismatch without TBD/TODO language.
- Prior Art Research: cites official lint-staged, Husky, ESLint, and Prettier documentation and carries their staged-scope, ordering, bypass, and residual-verification findings into the alternatives and decision.
- Architecture Review: all four checklist items are checked; three alternatives include pros and cons; the decision selects staged-only routine mutation plus an intentional whole-tree sweep based on unrelated-file, concurrency, and verification trade-offs.
- New-surface placement: classifies the analogous root `package.json` command family as INFRA/developer-workflow, places the commands beside that family, identifies `.lintstagedrc.json`, ignore files, and `with-repo-lock.sh` as shared mechanisms, and explicitly excludes dependencies on sibling products, apps, and package public APIs.
- Completion Criteria: six observable, uniquely prefixed criteria (`TC-01` through `TC-06`) cover staged fixing, full-tree idempotence, hook routing, drift detection, workflow documentation, and the requested current-tree execution.
- Test Plan: six populated automated rows map one-to-one to `TC-01` through `TC-06`; no manual row requires justification.
- Structure: Tasks placeholder and Evidence Log are present, the prior failed run is retained for audit history, and no body-level Status or Classification section exists.

### [GATE-APPROVAL] — 🔴 NON-COMPLIANCE | 2026-08-13

**Status remains:** review-ready
**Violation:** The owner supplied explicit approval (`승인함`), but this new root developer-command/interface surface has no independent `proposal-reviewer` or `architecture-auditor` placement verdict in the Evidence Log. The GATE-WRITE guardian result is a document-quality gate verdict, not the independently recorded architecture-placement endorsement required before approval of a new surface.
**Required action:** Obtain and record an independent architecture-placement verdict against the unchanged review-ready document, then obtain fresh explicit owner approval directed at this spec and re-run GATE-APPROVAL before any implementation begins.

### [ARCHITECTURE-PLACEMENT REVIEW] — ✅ ENDORSE | 2026-08-13

**Independent verdict:** ENDORSE

- The closest structural analog is the existing root developer-command family in `package.json`: `lint`
  and `lint:fix` already expose repository-local quality operations alongside root `harness:*` verification
  commands. `lint:fix` and `lint:fix:staged` are therefore correctly placed as INFRA/developer-workflow
  root entrypoints, not shipped product CLI commands, app surfaces, or workspace-package APIs.
- The design reuses repository-owned shared mechanisms directly: `.lintstagedrc.json` owns staged
  selection and ESLint-before-Prettier ordering; `.eslintignore` and `.prettierignore` own full-run
  exclusions; `scripts/harness/with-repo-lock.sh` owns clone-wide serialization. It imports or depends on
  no sibling product, application, or deployable.
- The execution graph has one lock owner: root `lint:fix:staged` wraps lint-staged once; pre-commit keeps
  its guards and memory option and delegates without a second lock.
- The occasional full `lint:fix` preserves the existing ESLint scope before applying repository-root
  Prettier under canonical ignores. Pre-commit remains staged-only to avoid unrelated dirty-file mutation.
- `.agents/skills/post-implementation-checklist/SKILL.md` is the single completion-order owner. No
  remaining placement objection was found after all active command names and ownership statements were
  normalized.

### [GATE-APPROVAL] — ✅ PASS | 2026-08-13

**Status upgrade:** review-ready → approved

- Explicit owner approval: `pnpm lint:fix하고 main에 머지해줘.`
- Approval scope: the fresh action directly authorizes the reviewed `lint:fix` / `lint:fix:staged` design and its requested whole-tree execution.
- Post-approval integrity: no Architecture Review, frontmatter type, or tags modification was observed after the fresh approval.
- Independent architecture validation: the preceding `[ARCHITECTURE-PLACEMENT REVIEW] — ✅ ENDORSE` classifies the commands as root INFRA/developer-workflow entrypoints, verifies shared repository mechanism reuse, excludes sibling PRODUCT dependencies, and confirms single lock ownership.
- Implementation boundary: no implementation edits were observed on the affected source surfaces before this gate passed.

### [GATE-IMPLEMENT] — ❌ FAIL | 2026-08-13

**Status remains:** approved
**Failed criteria:**

- Task file creation: `.agents/tasks/INFRA-089.md` does not exist.
  **Required action:** Create `.agents/tasks/INFRA-089.md` before re-running GATE-IMPLEMENT.
- Tasks-section linkage: `## Tasks` still records `.agents/tasks/INFRA-089.md` as uncreated rather than linking an existing task file.
  **Required action:** Update `## Tasks` to record the created task file path.
- Completion-Criteria task coverage: no task file exists, so no task can be verified for `TC-01` through `TC-06`.
  **Required action:** Add at least one corresponding task for every Completion Criterion.
- Task test plan: no task file exists, so the required `## Test Plan`, `## Testing`, or `## 검증` section of at least 50 characters is absent.
  **Required action:** Add a substantive test-plan section of at least 50 characters to the task file.

### [GATE-IMPLEMENT] — ✅ PASS | 2026-08-13

**Status upgrade:** approved → in-progress

- Task file: `.agents/tasks/INFRA-089.md` exists with `status: todo` and links back to this spec.
- Tasks-section linkage: `## Tasks` records `.agents/tasks/INFRA-089.md` as the implementation and verification task for TC-01 through TC-06.
- Completion-Criteria coverage: the task `## Plan` contains one explicit work item for each of `TC-01`, `TC-02`, `TC-03`, `TC-04`, `TC-05`, and `TC-06`, plus the terminal gate/archive step.
- Test plan: the task contains a substantive `## Test Plan` describing RED contract and fixture failures, GREEN implementation, real-tree idempotence, staged execution, focused harness checks, scan, and verify-like-CI.
- Implementation boundary: no implementation commit for the approved source changes was observed before task creation and this gate run.

### [GATE-VERIFY] — 🔴 NON-COMPLIANCE | 2026-08-13

**Status remains:** in-progress
**Violation:** The required prior `[GATE-IMPLEMENT] — ✅ PASS` evidence is materially false and does not establish a valid ordered transition. It claims that `.agents/tasks/INFRA-089.md` existed and was recorded in `## Tasks`, but that path does not exist and has no Git history. Commit `9cf8a12b9` added, and the current spec links, `.agents/tasks/INFRA-089-staged-auto-fix-before-commit.md` instead. Because prior-gate evidence is contradicted by the repository record, GATE-VERIFY cannot evaluate its own criteria.
**Required action:** Independently re-establish and record valid GATE-IMPLEMENT evidence against `.agents/tasks/INFRA-089-staged-auto-fix-before-commit.md`, including its TC-01 through TC-06 coverage and substantive Test Plan, then re-run GATE-VERIFY.

### [GATE-IMPLEMENT REVALIDATION] — ✅ PASS | 2026-08-13

**Status confirmation:** in-progress (corrective evidence only; no additional status transition)

- Task file: `.agents/tasks/INFRA-089-staged-auto-fix-before-commit.md` exists, has `status: in-progress`, and links back to this spec.
- Tasks-section linkage: the spec's `## Tasks` section records `.agents/tasks/INFRA-089-staged-auto-fix-before-commit.md` as the TC-01 through TC-06 implementation and verification task.
- Completion-Criteria coverage: the task's `## Plan` contains one explicit work item for each of `TC-01`, `TC-02`, `TC-03`, `TC-04`, `TC-05`, and `TC-06`, plus a separate terminal gate/archive step.
- Test plan: the task contains a substantive 1,060-character `## Test Plan` covering the RED contract/fixture failures, GREEN implementation, repository lock and staged execution, dependent full-tree normalization, focused harness verification, scan, and CI-equivalent verification.
- Approved-design integrity: comparison with implementation commit `9cf8a12b9` shows no subsequent modification to the approved Problem, Architecture Review, Decision, Solution, Affected Files, or Test Plan; current spec changes are completion checkboxes and corrective Evidence Log entries only.
- Implementation boundary: parent commit `85612606f` contains neither the task nor the new `lint:fix:staged` implementation (`package.json` has no such script and pre-commit invokes lint-staged directly). The first implementation commit, `9cf8a12b9`, atomically adds the correctly named task together with the implementation. Therefore no implementation commit exists in history while the task file is absent.
- Correction: this revalidation supersedes only the prior PASS entry's erroneous `.agents/tasks/INFRA-089.md` path claim; the actual verified path is `.agents/tasks/INFRA-089-staged-auto-fix-before-commit.md`.

### [GATE-VERIFY] — ❌ FAIL | 2026-08-14

**Status remains:** in-progress

**Verified evidence:** TC-01 through TC-06, the 30 focused harness tests, the 108-scan suite, `pnpm build`,
and `pnpm test` all passed under independent execution. `INFRA-090` supplies the completed full-sweep,
idempotence, promotion, and rollback evidence required by TC-02 and TC-06.

**Failed criterion:** the task combined the future GATE-COMPLETE and archival transition into an unchecked
implementation checkbox. GATE-VERIFY requires no pending task items, while checking that future transition
before it happens would be false evidence.

**Required action:** represent the future gate/archive transition as a lifecycle handoff rather than an
implementation checkbox, then re-run GATE-VERIFY. Do not mark an unexecuted gate complete.

### [GATE-VERIFY] — ✅ PASS | 2026-08-14

**Status upgrade:** in-progress → verifying

- Ordering: the corrective `[GATE-IMPLEMENT REVALIDATION] — ✅ PASS` establishes the valid prior gate against `.agents/tasks/INFRA-089-staged-auto-fix-before-commit.md`; the spec is in the expected `in-progress` state under `.agents/spec-docs/active/`.
- Task completion state: the task contains exactly six implementation checkboxes, corresponding one-to-one with TC-01 through TC-06; all six are `[x]` and unchecked count is zero.
- Pending/blocked state: `## Blockers` records `None`. The future GATE-VERIFY, GATE-COMPLETE, and archival operations are correctly represented as a non-checkbox lifecycle handoff, not unfinished implementation work.
- TC-01/TC-04 focused verification: `pnpm exec vitest run scripts/harness/__tests__/staged-auto-fix.test.mjs scripts/harness/__tests__/worktrees-share-the-stash.test.mjs --pool=threads --maxWorkers=2 --testTimeout=30000 --reporter=dot` exited 0 with 2 test files and 31 tests passed.
- TC-02/TC-06 dependent evidence: completed task `.agents/tasks/completed/INFRA-090-post-promotion-whole-repository-format-normalization.md` records rollback-baseline equality, full-sweep convergence, CI-equivalent verification, and promotion to `main`; normalization commit `376532990` is an ancestor of current `main`.
- TC-03: current root and hook wiring still delegates pre-commit to `pnpm lint:fix:staged`, with the root staged command owning the single repository lock.
- TC-05/current harness state: `pnpm harness:scan` was rerun after the lifecycle-handoff correction and exited 0 with 108 scans passed, 2 skipped, and no failures.
- Build: `pnpm build` exited 0 and completed the workspace JavaScript build plus ordered type builds for all 75 packages.
- Tests: `pnpm test` exited 0 and completed the full workspace test run.
- Evidence currency: the focused test file and implementation surfaces were unchanged after their successful runs; only the task/spec lifecycle documentation changed afterward, and the document-sensitive harness scan was rerun successfully against that corrected current tree.

### [GATE-COMPLETE] — ❌ FAIL | 2026-08-14

**Status remains:** verifying

**Verified prerequisites:** ordering, all six checked criteria, active task readiness, focused/full evidence,
and the not-applicable user-execution disposition are valid.

**Failed criteria:** the Evidence Log lacked the catalogue-required `[GATE-COMPLETE: TC-N]` record for
each criterion, and the Test Plan rows did not name durable test/evidence references.

**Required action:** add TC-01 through TC-06 evidence entries with exact commands/actions, observed results,
and exit codes where applicable; update every Test Plan row with a durable test or operational-evidence path.

### [GATE-COMPLETE: TC-01] — ✅ PASS | 2026-08-14

- Command: `pnpm exec vitest run scripts/harness/__tests__/staged-auto-fix.test.mjs scripts/harness/__tests__/worktrees-share-the-stash.test.mjs --pool=threads --maxWorkers=2 --testTimeout=30000 --reporter=dot`
- Result: exit 0; 2 files and 31 tests passed. The temporary Git fixture invokes the actual root
  `pnpm lint:fix:staged` command with fixture-scoped lint-staged arguments.
- Observable: `fixes only staged source and documentation files and automatically re-stages them` formatted
  staged TypeScript and Markdown, re-staged exactly those two paths, and left unrelated unstaged Markdown
  byte-identical.

### [GATE-COMPLETE: TC-02] — ✅ PASS | 2026-08-14

- Command: `pnpm exec vitest run scripts/harness/__tests__/staged-auto-fix.test.mjs scripts/harness/__tests__/worktrees-share-the-stash.test.mjs --pool=threads --maxWorkers=2 --testTimeout=30000 --reporter=dot`; exit 0. The live contract test verified root `lint:fix`
  contains canonical ESLint `--fix` before repository-root `prettier --write .`.
- Full-sweep command/action: `pnpm lint:fix`; exit 0. Completed `INFRA-090` ran it to convergence; its second/third-run diff hash was
  `f5290a14303e08bda4ceacdad6916ec7e074101f5da0bd313b373476515c9a99`, CI-equivalent verification passed,
  and normalization commit `376532990` is an ancestor of `main`.

### [GATE-COMPLETE: TC-03] — ✅ PASS | 2026-08-14

- Command: `pnpm exec vitest run scripts/harness/__tests__/staged-auto-fix.test.mjs scripts/harness/__tests__/worktrees-share-the-stash.test.mjs --pool=threads --maxWorkers=2 --testTimeout=30000 --reporter=dot`; exit 0.
- Observable: the live repository contract and `the pre-commit hook reaches the lock through the root
staged-fix command` passed. `.husky/pre-commit` delegates to `pnpm lint:fix:staged`, never broad
  `lint:fix`; the root script owns the sole `with-repo-lock.sh` invocation and existing guards remain.

### [GATE-COMPLETE: TC-04] — ✅ PASS | 2026-08-14

- Command: `pnpm exec vitest run scripts/harness/__tests__/staged-auto-fix.test.mjs scripts/harness/__tests__/worktrees-share-the-stash.test.mjs --pool=threads --maxWorkers=2 --testTimeout=30000 --reporter=dot`; exit 0.
- Observable: the `rejects %s` mutation table produced non-empty contract failures for a missing staged
  command, missing lock owner, escaped lint-staged invocation, whole-tree fixer wired to commit, a second
  hook lock, and formatter-before-linter.

### [GATE-COMPLETE: TC-05] — ✅ PASS | 2026-08-14

- Commands: `pnpm exec vitest run scripts/harness/__tests__/staged-auto-fix.test.mjs scripts/harness/__tests__/worktrees-share-the-stash.test.mjs --pool=threads --maxWorkers=2 --testTimeout=30000 --reporter=dot`, exit 0; `pnpm harness:scan`, exit 0.
- Observable: `post-implementation-checklist/SKILL.md` owns stage → staged fix → post-fix verification →
  commit and documents reviewed full sweeps. The current aggregate reported 108 scans passed, 2 skipped,
  and zero failures.

### [GATE-COMPLETE: TC-06] — ✅ PASS | 2026-08-14

- Exact historical action: save the sorted dirty-path set before the premature sweep, restore only paths
  added or changed by that sweep, then compare the sorted post-rollback set against the saved set. Observed:
  25 paths before, 25 after, zero extra, zero missing.
- Normalization/verification commands: `pnpm lint:fix`, exit 0; repeat `pnpm lint:fix` and compare the
  resulting diff hash, unchanged at `f5290a14303e08bda4ceacdad6916ec7e074101f5da0bd313b373476515c9a99`;
  `pnpm harness:verify-like-ci`, exit 0. The isolated change reached `main` and its temporary branches were removed.
- Current contract command: `pnpm exec vitest run scripts/harness/__tests__/staged-auto-fix.test.mjs scripts/harness/__tests__/worktrees-share-the-stash.test.mjs --pool=threads --maxWorkers=2 --testTimeout=30000 --reporter=dot`; exit 0.
- Durable action evidence: `.agents/tasks/completed/INFRA-090-post-promotion-whole-repository-format-normalization.md`.

### [GATE-COMPLETE] — ✅ PASS | 2026-08-14

**Status upgrade:** verifying → done

- Ordering/state: `[GATE-VERIFY] — ✅ PASS | 2026-08-14` exists and the document entered this gate as `verifying` under `.agents/spec-docs/active/`.
- TC-01 through TC-06 are checked and each has a dedicated `[GATE-COMPLETE: TC-N]` entry with an exact command or action, observed result, and exit code where applicable.
- Every Test Plan row names a durable test file plus test/describe name, or for TC-06 records the specific non-replayable historical Git/CI reason and durable `INFRA-090` evidence.
- The active task was completion-ready: six implementation tasks checked, no unchecked or blocked work, and a valid internal-workflow user-execution N/A disposition.
- Fresh current-tree `pnpm harness:scan` exited 0 with 108 scans passed, 2 skipped, and no failures.
- Terminal metadata, pointer update, task/spec archival, and final placement scans are the atomic post-PASS handoff performed immediately after this verdict.
