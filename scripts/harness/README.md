# Harness Scripts

These scripts are the executable layer of the Robota harness.

## Current Commands

- `pnpm harness:scan`
- `pnpm harness:scan:consistency`
- `pnpm harness:scan:commands`
- `pnpm harness:scan:sdk-public-surface`
- `pnpm harness:scan:specs`
- `pnpm harness:scan:coverage-scripts`
- `pnpm harness:plan -- --changed-file <path> [--changed-file <path>] [--base-ref <git-ref>]`
- `pnpm harness:pre-push`
- `HARNESS_PRE_PUSH_MODE=full pnpm harness:pre-push`
- `pnpm harness:verify -- --scope <packages/foo|apps/bar> [--include-scenarios] [--base-ref <git-ref>] [--skip-dependent-scopes]`
- `pnpm harness:verify:release`
- `pnpm harness:record -- --scope <packages/foo|apps/bar> [--base-ref <git-ref>]`
- `pnpm harness:review -- --scope <packages/foo|apps/bar> [--report-file <path>] [--report-format markdown|json] [--base-ref <git-ref>]`
- `pnpm harness:self-check`
- `pnpm harness:cleanup`

## Ownership Rules

- `pnpm-workspace.yaml` is the source of truth for workspace scope discovery.
- `AGENTS.md` is the source of truth for rule anchors and harness policy.
- Skills under `.agents/skills/` describe task workflows, not repository law.

## Script Roles

### `pnpm harness:scan`

- runs consistency, spec ownership, and docs structure scans as one gate
- verifies that testable workspace packages expose `test:coverage` without running coverage
- is the default repository-wide pre-review harness command

### `scan-consistency.mjs`

- validates skill anchors against `AGENTS.md`
- detects known contradiction phrases
- checks workspace pattern alignment between `package.json` and `pnpm-workspace.yaml`
- checks that the root package exposes the standard harness command surface
- fails when a workspace owns `examples/` but does not expose `scenario:verify`
- fails when a workspace owns `examples/` but does not expose `scenario:record`
- fails when a workspace owns `examples/` but does not keep `examples/scenarios/*.record.json`
- validates that authoritative scenario records align one-to-one with the current owner scenario command set

### `check-command-layering.mjs`

- verifies that CLI/TUI code does not own provider slash command state or setup flow
- verifies that legacy CLI command-source files do not return after migration
- verifies that slash routing does not add command-specific built-in branches
- verifies that `agent-sdk` does not import or depend on `agent-command-*` implementation packages
- verifies that `agent-command-*` packages do not import `agent-cli`

### `check-sdk-public-surface.mjs`

- verifies that `agent-sdk` public barrels do not use broad export-star pass-throughs
- verifies that the top-level SDK entrypoint does not hide `agent-core`, `agent-sessions`, or `agent-tools` ownership
- verifies that `agent-runtime` re-exports stay in documented SDK runtime facade barrels

### `check-test-coverage-scripts.mjs`

- statically verifies that every workspace package with a Vitest or Jest `test` script exposes `test:coverage`
- verifies that the root package exposes `test:coverage`, `test:coverage:packages`, and `test:coverage:apps`
- verifies that `harness:scan` includes the static coverage script check
- does not run coverage; package coverage remains an explicit opt-in command

### `audit-spec-coverage.mjs`

- checks whether each actual workspace owns `docs/SPEC.md`
- checks whether each workspace docs index points to `SPEC.md`
- reports current coverage and missing scopes

### `plan-change.mjs`

- resolves workspace scopes from explicit `--changed-file` fixtures or changed files from Git
- reports which package/app checks would run without executing those checks
- keeps files outside workspace scopes visible as repository review inputs
- can persist the plan as JSON or Markdown via `--report-file`

### `pre-push.mjs`

- resolves the branch-appropriate comparison base through the harness base-ref primitive
- reads Git pre-push ref updates from stdin
- skips verification for delete-only pushes because no repository content is being published
- skips verification when the pushed tree already matches the resolved base, such as cleanup after a squash-merged PR
- does not use the tree-equivalent skip when the local working tree is dirty
- prints the scoped verification plan
- defaults to fast mode, which verifies directly changed scopes and executable repository checks
- uses `--skip-dependent-scopes` in fast mode so local push latency does not explode on shared package entrypoint changes
- supports `HARNESS_PRE_PUSH_MODE=full` when dependent scope typechecks should run locally before publishing
- leaves release-grade verification as an explicit `pnpm harness:verify:release` command

### `verify-change.mjs`

- resolves workspace scopes from changed files or `--scope`
- falls back to `git diff <base-ref>...HEAD` when the working tree is clean
- runs build, test, lint, and typecheck for the relevant scope
- includes dependent scopes by default for public entrypoint, dependency manifest, and public-surface manifest changes
- supports `--skip-dependent-scopes` for fast local gates that intentionally avoid broad dependent checks
- runs owner-registered scenario verification when scenario-like changes, source/config changes in scenario-owning scopes, or `--include-scenarios` are present
- fails if authoritative scenario records are missing, invalid, duplicated, or do not match the owner command set
- compares scenario verification output against the owner `*.record.json` artifact and fails on drift
- supports `--dry-run`

### `record-change.mjs`

- resolves workspace scopes from changed files or `--scope`
- falls back to `git diff <base-ref>...HEAD` when the working tree is clean
- runs owner-registered `scenario:record` commands for the relevant scope
- refreshes authoritative `*.record.json` artifacts as an explicit harness action

### `scenario-owner-map.mjs`

- resolves package-level `scenario:verify` and `scenario:record` scripts first
- keeps a narrow extension point for exceptional scopes that cannot yet expose standard scripts
- should remain close to empty as owner packages adopt standard scenario commands

### `review-change.mjs`

- summarizes risk for the selected scope
- falls back to `git diff <base-ref>...HEAD` when the working tree is clean
- highlights repository-level policy or harness changes
- can persist the review as Markdown or JSON via `--report-file`
- recommends follow-up harness commands

### `pnpm harness:self-check`

- exercises the canonical `packages/agents` scenario verification path
- validates the authoritative record artifact structure
- proves both positive match and negative drift detection against the same artifact

### `pnpm harness:cleanup`

- scans for stale `.design/tmp/` documents (older than 14 days)
- checks SPEC.md quality against the Spec Quality Gate (8 required sections)
- detects unregistered skills (exist on disk but not in AGENTS.md)
- detects stale skill references (in AGENTS.md but no directory on disk)
- scans for forbidden agent hierarchy terms in production code
- flags dynamic imports in production code for manual review
- reports findings grouped by type with summary counts

## Design Notes

- Commands are intentionally narrow and explicit.
- Local working tree changes take priority; clean checkout flows should pass `--base-ref <git-ref>` when the default base inference is not enough.
- Scope detection must follow actual workspace ownership, not ad-hoc package discovery.
- If an invariant matters repeatedly, prefer extending these scripts over adding more prose.

## Portable Harness Patterns

Several guards here started as Robota-specific fixes but encode a **general principle** that ports to
any repo. For each: the universal idea, the project-specific part, and what to adjust when porting.

### 1. Ghost-path meta-scan (`check-harness-config-paths.mjs`)

- **General principle:** any place that hardcodes a file path (scan configs, codegen manifests, docs)
  drifts silently when files move. A meta-scan that verifies hardcoded path literals still resolve —
  with an explicit `allow-missing` marker for negative assertions/fixtures — catches relocation rot.
- **Project-specific:** scopes to `scripts/harness/*.mjs` and the `packages|apps|scripts` roots.
- **Porting:** change the scanned glob + path roots; keep the quoted-literal + comment-exempt +
  marker model. Origin: [`LESSON-006`](../../.agents/backlog/completed/LESSON-006-post-relocation-reference-sweep.md).

### 2. Live-seam cold-state testing (skill: `vitest-testing-strategy`)

- **General principle:** a state-mutation seam on a lazily-initialized collaborator must be tested on
  the **cold** (never-used) path with a real collaborator; mocking the collaborator that owns the
  init guard hides the bug.
- **Project-specific:** the `/preset` → `Robota.setModel` seam.
- **Porting:** applies to any lazy-init + post-construction mutation. Origin:
  [`LESSON-001`](../../.agents/backlog/completed/LESSON-001-live-seam-cold-state-testing.md).

### 3. Protected-branch commit guard (`.husky/pre-commit`)

- **General principle:** enforce branch policy at the **git-native** layer, not only at an
  agent/tool layer whose command parsing can fail. A pre-commit `git branch --show-current` check
  fires for every commit regardless of how it is invoked.
- **Project-specific:** protected set `main|master|develop`; `ALLOW_PROTECTED_COMMIT` override.
- **Porting:** change the protected set. Origin:
  [`LESSON-003`](../../.agents/backlog/completed/LESSON-003-protected-branch-commit-guard.md).

### 4. Destructive-flag block in the agent hook (`.claude/hooks/branch-guard.sh`)

- **General principle:** a banned-but-tempting flag (here `gh pr merge --delete-branch`, which once
  deleted an integration branch) should be blocked mechanically at the agent's tool boundary, not
  left as prose the agent can forget.
- **Project-specific:** the `gh pr merge` + `--delete-branch` combo.
- **Porting:** swap the command/flag pair. Origin:
  [`LESSON-007`](../../.agents/backlog/completed/LESSON-007-gh-delete-branch-guard.md).
