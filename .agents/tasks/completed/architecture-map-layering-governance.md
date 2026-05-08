# Architecture Map Layering Governance

## Status

Completed.

## Created

2026-05-09

## Completed

2026-05-09

## Branch

`docs/architecture-map-layering-review`

## Scope

- `.agents/rules/spec-workflow.md`
- `.agents/rules/documentation-sync.md`
- `.agents/rules/process.md`
- `.agents/rules/index.md`
- `.agents/rules/common-mistakes.md`
- `.agents/specs/ARCHITECTURE-MAP.md`
- `.agents/specs/architecture-map/*.md`
- `.agents/backlog/*.md`
- `.agents/tasks/completed/architecture-map-layering-governance.md`

## Problem

After the DAG ownership split, the repository architecture map correctly routes agent, CLI,
provider, app, and deployment boundaries. The remaining risk is that product-shell guidance is
strongest in the CLI-specific documents, while repository-wide feature placement is only implicit.

This can let a future implementation place reusable behavior in a product shell first, then document
the lower reusable owner later. That violates the architecture rule that UI shells render and
compose owner APIs, while SDK/runtime/command/provider/service packages own reusable behavior.

## Recommendation

Promote feature placement into a repository-wide architecture-map slice and make document authority
explicit in rule documents.

Reasons:

- The rule applies to every product shell, not only `agent-cli`.
- Background tasks, commands, providers, transports, auth, credits, and server boundaries cross
  package families and need an owner-first change path.
- Architecture maps should record accepted boundaries; package/app SPEC files should record owner
  contracts; design, task, and backlog files should hold rationale, plans, and follow-up work.

## Work Plan

- [x] Review architecture-map documents and governing rules.
- [x] Add a repository-wide capability placement map.
- [x] Update rule documents for architecture/design/SPEC authority.
- [x] Clarify product-shell composition-root adapter imports versus behavior ownership.
- [x] Add follow-up backlog for mechanical ownership guards.
- [x] Add follow-up backlog for document authority consistency guards.
- [x] Add follow-up backlog for background workspace projection conformance.
- [x] Add follow-up backlog for agent server boundary audit.
- [x] Run documentation and harness verification.
- [x] Archive this task when complete.

## Decisions

- Keep architecture-map documents in English because they are repository documents outside
  `.design/`.
- Do not create a `.design/` proposal for this small governance cleanup. The design rationale is
  captured in this task and the follow-up backlog items; the accepted rules go into the rule and
  architecture-map documents.
- Do not start source-code refactors from this review. The architecture map already reflects the
  recent SDK execution workspace and CLI switcher work; remaining code checks should be separate
  backlog items with clear verification scopes.

## Completed Changes

- Added repository-wide capability placement rules under the architecture map.
- Added rule-level authority separation for architecture documents, design documents, package/app
  SPEC files, cross-cutting specs, public docs, task files, and backlog files.
- Clarified that document authority is determined by path and role, not only by words like
  `architecture` in a filename.
- Added backlog items for capability-placement guards, document-authority guards, background
  workspace conformance, and agent server boundary audit.

## Test Strategy

This is documentation and rule governance work, so verification focuses on repository guidance
consistency rather than package runtime behavior. Run `pnpm harness:scan` to check rule/spec/task
coverage and `pnpm docs:build` to confirm documentation generation still succeeds after architecture
map and rule updates.

## Verification

- `pnpm docs:build` passed.
- `pnpm harness:scan` passed. It still reports the existing non-blocking file-size warnings for
  large source files.
