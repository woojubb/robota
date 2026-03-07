# Harness Scripts

These scripts are the executable layer of the Robota harness.

## Current Commands

- `pnpm harness:scan`
- `pnpm harness:scan:consistency`
- `pnpm harness:scan:specs`
- `pnpm harness:verify -- --scope <packages/foo|apps/bar> [--include-scenarios] [--base-ref <git-ref>]`
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

### `audit-spec-coverage.mjs`

- checks whether each actual workspace owns `docs/SPEC.md`
- checks whether each workspace docs index points to `SPEC.md`
- reports current coverage and missing scopes

### `verify-change.mjs`

- resolves workspace scopes from changed files or `--scope`
- falls back to `git diff <base-ref>...HEAD` when the working tree is clean
- runs build, test, lint, and typecheck for the relevant scope
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

### `record-owner-scenario.mjs`

- runs a package-owned record command and writes a canonical JSON artifact under the package-owned scenarios directory
- stores normalized stdout/stderr plus hashes so records are comparable across runs

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
- checks DAG package dependency direction (sibling imports)
- flags dynamic imports in production code for manual review
- reports findings grouped by type with summary counts

## Design Notes

- Commands are intentionally narrow and explicit.
- Local working tree changes take priority; clean checkout flows should pass `--base-ref <git-ref>` when the default base inference is not enough.
- Scope detection must follow actual workspace ownership, not ad-hoc package discovery.
- If an invariant matters repeatedly, prefer extending these scripts over adding more prose.
