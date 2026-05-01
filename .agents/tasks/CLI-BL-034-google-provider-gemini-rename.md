# CLI-BL-034 Google Provider to Gemini Provider Rename Migration

- **Status**: todo
- **Created**: 2026-05-01
- **Branch**: TBD
- **Scope**: packages/agent-provider-google, packages/agent-provider-gemini, packages/agent-cli, docs

## Objective

Evaluate and plan a compatibility-safe migration from `agent-provider-google` to `agent-provider-gemini`. The current package name is broader than the implementation responsibility, which is centered on Google Gemini API behavior.

## Problem

`agent-provider-google` currently owns Gemini API integration, Gemini message conversion, Gemini function declaration conversion, and Gemini image-capable model behavior. As Robota adds separate model-family providers such as Gemma, the package name `google` becomes ambiguous because Google can mean product platform, model family, or API vendor.

Renaming directly would affect imports, package documentation, CLI provider type names, package publishing, and downstream user code. This must be handled as its own migration rather than bundled into Gemma provider implementation.

## Recommended Direction

- Introduce `agent-provider-gemini` as the canonical package for Google Gemini API behavior.
- Keep `agent-provider-google` as a compatibility package for at least one migration window.
- Decide whether compatibility means a thin wrapper re-export package, duplicated package entry, or deprecation-only documentation.
- Keep `agent-provider-gemma` separate from `agent-provider-gemini`; Gemma served through LM Studio/OpenAI-compatible APIs should not be owned by the Gemini API provider.
- Let CLI support `type: "gemini"` as the canonical future provider type while preserving `type: "google"` during migration if backwards compatibility is required.

## Plan

- [ ] Audit current `agent-provider-google` public exports, docs, examples, and CLI references.
- [ ] Decide the migration style: wrapper package, package rename with compatibility alias, or documentation-only deprecation.
- [ ] Define package dependency direction so compatibility wrappers do not create cycles.
- [ ] Update package SPEC files before code changes.
- [ ] Add CLI settings tests for canonical and compatibility provider type names.
- [ ] Update documentation and changelog migration notes.
- [ ] Run package build/test/typecheck and harness scans.

## Test Plan

- Given existing user code imports `@robota-sdk/agent-provider-google`, when the compatibility plan is implemented, then documented migration behavior remains valid and tested.
- Given a new user config selects `type: "gemini"`, when the CLI creates a provider, then it uses the Gemini API provider implementation.
- Given an existing config selects `type: "google"`, when compatibility support is enabled, then the CLI either creates the same provider or emits the documented migration error.
- Given package specs are updated, when `pnpm harness:scan:specs` runs, then the new or renamed package is covered by `docs/SPEC.md`.
- Given dependency-direction checks run, when compatibility packages depend on canonical packages, then no bidirectional workspace dependency is introduced.

## Decisions

- Do not bundle this rename with `CLI-BL-033`; Gemma provider work and Gemini rename work have different compatibility risks.
- Treat `agent-provider-gemini` as the more accurate long-term name for Google Gemini API behavior.
- Treat `agent-provider-gemma` as a separate model-family provider for local/OpenAI-compatible servers.

## Progress

### 2026-05-01

- Created as a follow-up from Gemma provider package-boundary discussion.

## Blockers

- Need semver and publish strategy before choosing whether `agent-provider-google` becomes a wrapper or remains the canonical package for one more release.

## Result

Not started.
