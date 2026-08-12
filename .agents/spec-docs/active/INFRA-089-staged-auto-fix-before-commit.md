---
status: in-progress
type: INFRA
tags: [cli, typescript]
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

- [ ] TC-01: `pnpm lint:fix:staged` with staged malformed TS/JS and Markdown fixtures exits 0, applies ESLint before Prettier where applicable, and leaves unrelated unstaged fixtures byte-identical.
- [ ] TC-02: the `pnpm lint:fix` command contract applies ESLint fix to the canonical full lint scope and then Prettier to the repository root under canonical ignore files; actual whole-tree execution is deferred to a fresh post-promotion normalization branch so it cannot obstruct earlier feature merges.
- [ ] TC-03: `.husky/pre-commit` invokes the root `lint:fix:staged` command, never full `lint:fix`, while preserving the clone-wide repository lock and all existing guards.
- [ ] TC-04: a harness test fails against a fixture that removes either command, hook delegation, the lock, or reverses ESLint/Prettier order, and passes against the repository configuration.
- [ ] TC-05: the canonical change-completion workflow states `stage → pnpm lint:fix:staged → verify → commit`, documents `pnpm lint:fix` as an occasional reviewed full sweep, and `pnpm harness:scan` exits 0.
- [ ] TC-06: the attempted current-tree full sweep is reverted exactly to its pre-run dirty-path baseline; current intended paths pass `pnpm lint:fix:staged` and affected verification runs afterward; a dependent normalization work item records the post-main execution.

## Test Plan

| TC-ID | Test Type              | Tool / Approach                                                                                                                   | Notes                                                                              |
| ----- | ---------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| TC-01 | CI pipeline smoke test | Temporary Git fixture invoking `pnpm lint:fix:staged`; byte comparison for unrelated file                                         | Include partially staged behavior if the existing lint-staged harness supports it. |
| TC-02 | CI pipeline smoke test | Assert canonical ESLint scope followed by `prettier --write .`; execute and prove idempotence in the dependent normalization item | Broad mutation starts only after current work reaches main.                        |
| TC-03 | CI pipeline smoke test | Harness assertion over `package.json` and `.husky/pre-commit`, plus existing hook tests                                           | Preserve current guard ordering and staged-only hook scope.                        |
| TC-04 | CI pipeline smoke test | RED fixture mutations followed by the new Vitest harness test                                                                     | Proves the mechanism, not only the happy path.                                     |
| TC-05 | CI pipeline smoke test | `rg` assertion for the canonical workflow plus `pnpm harness:scan`                                                                | No manual-only criterion.                                                          |
| TC-06 | CI pipeline smoke test | Compare pre/post rollback status sets, run staged fix and affected verification, and link the dependent normalization task        | Broad normalization remains separately reviewable.                                 |

## Tasks

- [ ] `.agents/tasks/INFRA-089-staged-auto-fix-before-commit.md` — TC-01 through TC-06 implementation and verification

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
