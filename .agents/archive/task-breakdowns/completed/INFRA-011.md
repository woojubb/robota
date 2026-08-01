# INFRA-011 Tasks — Architecture doc P2 cleanup batch

Spec: `.agents/spec-docs/todo/INFRA-011-architecture-doc-p2-cleanup.md`

## Tasks

- [x] TC-01: Remove the stale package names and fix the agent-framework Scope (AF-21/AF-22/AF-23).
      In `.agents/specs/architecture-map/repository-overview.md`, replace the
      `agent-web (browser monitor)` entry with `agent-web-ui` and add
      `agent-interface-transport`/`agent-interface-tui`. In `packages/agent-command/docs/SPEC.md:11`,
      change the phantom `agent-transport-*` to the single `agent-transport`. In
      `packages/agent-framework/docs/SPEC.md`, add `agent-interface-transport` to the Scope
      composition list. Assert via
      `rg -n 'agent-web \(browser monitor\)' repository-overview.md` and
      `rg -n 'agent-transport-\*' packages/agent-command/docs/SPEC.md` both returning nothing, and the
      framework SPEC Scope line naming `agent-interface-transport`.
- [x] TC-02: Fix the aspirational-arrow note, the interface-package plural, and the stale date
      (AF-15/AF-16/AF-17). In `.agents/specs/architecture-map/capability-placement.md`, add a note that
      the `Assembly --> Adapters` / `Assembly --> Orchestration` arrows are ownership-policy arrows,
      not actual package edges (only `agent-framework → agent-tools` is a real edge). In
      `.agents/project-structure.md:78`, change the plural `agent-interface-*` to the single
      `agent-interface-transport`. In `.agents/specs/ARCHITECTURE-MAP.md:3`, update the
      source-verified date to `2026-06-13`.
- [x] TC-03: Run `pnpm harness:scan` and confirm it exits 0 (including the conformance scan), since
      these are doc-only edits with no `packages/*` production code touched.

## Test Plan

Verification is mechanical and command-driven for all three criteria:

- TC-01: `rg` grep assertions over `repository-overview.md`, `packages/agent-command/docs/SPEC.md`,
  and `packages/agent-framework/docs/SPEC.md` confirm the stale `agent-web (browser monitor)` entry
  and the phantom `agent-transport-*` token are gone and the framework Scope line names
  `agent-interface-transport`.
- TC-02: `rg` grep assertions over `capability-placement.md`, `project-structure.md`, and
  `ARCHITECTURE-MAP.md` confirm the ownership-policy note is present, the line names the single
  `agent-interface-transport` (not plural `agent-interface-*`), and the source-verified date reads
  `2026-06-13`.
- TC-03: `pnpm harness:scan` exits 0 (doc-only change; conformance scan included).
