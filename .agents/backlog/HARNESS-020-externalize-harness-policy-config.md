---
title: 'HARNESS-020: Externalize harness policy to .agents/harness.config.json (generic engine + swappable policy)'
status: todo
created: 2026-06-27
priority: medium
urgency: later
area: scripts/harness, .agents
depends_on: []
---

# Externalize harness policy — generic engine + swappable policy

Implementation follow-through on the universality direction documented (docs-only) by
`completed/HAUDIT-005-portable-harness-patterns`. HAUDIT-005 wrote down the portable
_patterns_; this item extracts the _policy data_ so the engine is actually reusable.

## What

The scan **engine** is already repo-agnostic (`shared.mjs` `listWorkspaceScopes`/`walkFiles`),
but the **policy data** is hardcoded as literals inside individual scripts, so the suite can't
be lifted into another repo without editing source. Hotspots (verified 2026-06-27):

- `check-dependency-direction.mjs:162` — `ALLOWED_ROBOTA_DEPS = new Set(['@robota-sdk/agent-core'])`
  and the `@robota-sdk/` prefix at `:168`.
- `check-capability-placement.mjs:17` — `PRODUCT_SHELL_DIRS = ['packages/agent-cli','apps/agent-web','apps/docs','apps/blog']`.
- `self-check.mjs:24,129` — `ROBOTA_DISABLE_LESSONS_DIGEST` env name + canonical `agent-core` scope.
- `check-command-layering.mjs`, `check-background-workspace-conformance.mjs`,
  `check-agent-server-boundary.mjs`, `check-publish-safety.mjs`, `bootstrap.mjs` — file-path
  and package-name literals.

The repo already diagnosed this class of risk: `check-harness-config-paths.mjs` (LESSON-006)
exists only because scripts hardcode workspace paths and a stale path silently passes. That
meta-scan defends the symptom; this item removes the root cause.

Steps:

1. Introduce `.agents/harness.config.json` (with a small typed loader in `shared.mjs`) holding:
   `npmScopePrefix`, `internalDependencyLayers`/`allowedInternalDeps`, `productShellDirs`,
   `selfCheck.scope`, `commandLayering.files`, and the lessons-digest env name.
2. Refactor the highest-literal scripts first (`check-dependency-direction`,
   `check-capability-placement`, `check-command-layering`, `check-agent-server-boundary`) to
   read from the config instead of inline literals.
3. Neutralize product-name identifiers: `ALLOWED_ROBOTA_DEPS` → `ALLOWED_INTERNAL_DEPS`,
   `ROBOTA_DISABLE_LESSONS_DIGEST` → `HARNESS_DISABLE_LESSONS_DIGEST` (aligns with
   `feedback_no_product_names`). Keep behavior identical.

(Genuinely project-specific _rules_ like `check-sdk-react-free` / `check-agent-server-boundary`
stay — the goal is policy-as-data + generic engine, not removing the rules.)

## Why

Today the generic engine and Robota-specific policy live in the same files, so the 30-scan
suite can't be adopted by another repo without source edits. Policy-as-data turns it into a
generic engine + a single editable config — directly serving "make the harness universal" —
and removes the stale-literal failure mode LESSON-006 currently patches over.

## Done When

- `.agents/harness.config.json` exists and is consumed by at least the four highest-literal
  scripts; those scripts contain no inlined product/package/path policy literals.
- Product-name identifiers are renamed to neutral names; no behavior change.
- `pnpm harness:scan` passes (identical results to before the refactor).
- `check-harness-config-paths.mjs` validates the new config's paths too (no new ghost paths).

## Test Plan

- Before/after `pnpm harness:scan` → identical pass set.
- Grep refactored scripts for `@robota-sdk`/`ROBOTA_`/hardcoded `packages/...` literals → moved
  to config.
- Point the config at a throwaway value and confirm the corresponding scan's behavior changes
  (proves it reads config, not a literal).

## User Execution Test Scenarios

1. Edit a value in `.agents/harness.config.json` (e.g. add an allowed internal dep) and run
   `pnpm harness:scan` → the dependency-direction scan honors the config without any source
   edit. Evidence: _to fill._
