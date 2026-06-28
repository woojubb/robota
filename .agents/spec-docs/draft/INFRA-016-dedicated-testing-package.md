---
status: draft
type: INFRA
tags: [build, testing]
---

# INFRA-016: Consolidate scattered testing utilities into a dedicated package

## Problem

Test-support utilities are spread across multiple packages with no single owner, so cross-package
test infrastructure is duplicated and hard to discover/reuse:

- `packages/agent-core/src/testing` (exported via the `./testing` subpath)
- `packages/agent-framework/src/testing` (`scriptedSession`, `ScriptedSessionHarness`, the
  functional-coverage kit; `./testing` subpath)
- `packages/agent-transport/src/testing` (`./testing` subpath)
- `packages/agent-transport-tui/src/__tests__/pty/` (TEST-007 `spawnPty`/`spawnPtyFixture` PTY
  harness — currently buried under `__tests__`, not exported, only reachable by relative import)
- `scripts/harness/functional-coverage-manifest.json` and related harness glue

Concrete symptom: the new reusable PTY harness (TEST-007) lives under one package's `__tests__` and
cannot be consumed by other packages without reaching across `__tests__` boundaries; the
`scriptedSession` kit is framework-only; there is no home for genuinely cross-cutting test helpers.
This mirrors the pattern (observed in other tools) of a dedicated testing-utilities package.

Reproduction: try to reuse `spawnPtyFixture` from a package other than `agent-transport-tui` — there
is no importable entry point; you would relative-import into another package's `__tests__`.

## Goal (to refine during design)

Introduce a dedicated, scoped testing package (e.g. `@robota-sdk/agent-testing`) that owns
cross-cutting test infrastructure — at minimum the PTY harness (TEST-007), and candidate homes for
the scripted-session kit and shared fixtures — with proper `devDependency`-only consumption and no
violation of the dependency-direction rules.

## Open Design Questions (must resolve before GATE-WRITE)

1. **Dependency direction vs. agent-core zero-deps** ([[feedback_core_no_deps]]): `agent-core` must
   not depend on any `agent-*` package. A shared testing package that depends on core/framework is
   fine for consumers, but core's OWN test utils cannot move into a package that depends on core
   (cycle). Decide what actually consolidates vs. what must stay package-local.
2. **Scope boundary**: which of `agent-core/testing`, `agent-framework/testing`,
   `agent-transport/testing` are package-contract test surfaces (stay put, published as `./testing`)
   vs. generic harness code (move). The PTY harness is the clear first mover.
3. **Publish posture**: is the package published (`@robota-sdk/*` scope, per
   [[feedback_scoped_package_naming]]) or private/workspace-only test tooling? Affects build/SPEC
   requirements.
4. **functional-coverage manifest ownership**: does the manifest/scan move with the package?
5. **Naming**: confirm `@robota-sdk/agent-testing` vs. an alternative (user decision —
   [[feedback_no_unilateral_decisions]]).

## Notes

- This is a capture item (idea logged per [[feedback_capture_ideas_as_todo]]); it is intentionally at
  `draft` and is NOT being implemented now. It will go through the normal gate pipeline
  (GATE-WRITE → GATE-APPROVAL → …) once the open design questions above are resolved and the user
  approves a concrete design.
- Trigger: requested while approving SCREEN-010, after observing dedicated testing-library packaging
  in another tool.

## Affected Scope (preliminary)

- New package under `packages/` + workspace wiring (pnpm, tsconfig refs, build order)
- `packages/agent-transport-tui` (move/re-export the PTY harness)
- Possibly `packages/agent-framework`, `packages/agent-core`, `packages/agent-transport` (testing
  subpaths) — pending the dependency-direction decision
- `scripts/harness/` (functional-coverage glue) — pending ownership decision
