# CLI-BL-043 Gemini Provider Package Rename Compatibility Migration

- **Status**: backlog
- **Created**: 2026-05-02
- **Scope**: packages/agent-provider-google, packages/agent-provider-gemini, packages/agent-cli, docs, publish registry
- **Related**: .agents/tasks/completed/CLI-BL-034-google-provider-gemini-rename.md

## Objective

Plan and implement the package-level migration from the current `@robota-sdk/agent-provider-google` package to a canonical `@robota-sdk/agent-provider-gemini` package while preserving existing user imports and `type: "google"` provider profiles for a defined compatibility window.

## Current State

`CLI-BL-034` completed the compatibility-first slice:

- `@robota-sdk/agent-provider-google` still owns the Gemini API implementation.
- `createGeminiProviderDefinition()` exposes canonical provider type `gemini`.
- `google` is accepted as a compatibility alias through the generic `IProviderDefinition.aliases` contract.
- Direct Gemini transport uses `@google/genai`.
- CLI composes the provider definition generically and does not branch on `gemini` or `google`.

The remaining issue is package identity. The package name still says `google`, while its runtime responsibility is Gemini API behavior.

## Research Plan

Before implementation, verify current package migration practices from public documentation:

- npm package deprecation and replacement package guidance.
- How SDK packages communicate package rename migrations while preserving import compatibility.
- Robota release and publish rules for adding a new publishable package with synchronized monorepo versions.

## Recommended Direction

Use a compatibility-wrapper migration:

- Create `@robota-sdk/agent-provider-gemini` as the canonical implementation package.
- Make `@robota-sdk/agent-provider-google` depend on and re-export from `agent-provider-gemini` for one migration window.
- Keep provider profile `type: "gemini"` canonical and `type: "google"` as a provider-definition alias.
- Keep `GoogleProvider` as a compatibility export if downstream code imports that class name; introduce `GeminiProvider` as the canonical class name.
- Update CLI default provider composition to import from `agent-provider-gemini` once the new package exists.
- Update docs and publish registry together so package identity and release policy stay consistent.

## Plan

- [ ] Update package specs before code changes for both canonical and compatibility packages.
- [ ] Add `packages/agent-provider-gemini` with the canonical implementation and public exports.
- [ ] Convert `packages/agent-provider-google` into a compatibility package that re-exports canonical behavior without duplicating implementation.
- [ ] Preserve `GoogleProvider` compatibility export and add canonical `GeminiProvider`.
- [ ] Keep `createGeminiProviderDefinition()` canonical and preserve `google` alias.
- [ ] Update CLI composition root to import the canonical package without provider-name-specific branches.
- [ ] Update project structure, publish registry, README files, and migration notes.
- [ ] Add tests proving both old and new import paths work and resolve equivalent provider definitions.
- [ ] Run package builds, typecheck, lint, targeted tests, publish scan, and full harness scan.

## Test Plan

- Given user code imports from `@robota-sdk/agent-provider-gemini`, when it creates `GeminiProvider`, then direct chat/stream behavior matches the current implementation.
- Given user code imports from `@robota-sdk/agent-provider-google`, when it creates `GoogleProvider`, then the compatibility package reuses canonical implementation and behavior remains unchanged.
- Given CLI default provider definitions are assembled, when provider type `gemini` is selected, then the canonical package definition is used.
- Given an existing settings profile uses `type: "google"`, when provider resolution runs, then alias resolution still creates the Gemini provider.
- Given package dependency checks run, when compatibility package imports canonical package, then no workspace cycle is introduced.
- Given publish scans run, when the new package is added, then publish registry and package versions are synchronized.

## Acceptance Criteria

- `@robota-sdk/agent-provider-gemini` exists as the canonical package.
- `@robota-sdk/agent-provider-google` remains functional as a compatibility import path for the documented migration window.
- Generic CLI/SDK code remains free of provider-name branching.
- Provider profile alias compatibility for `google` continues to work.
- Documentation clearly states the package migration path and compatibility window.

## Blockers

None.

## Result

Pending.
