# CLI-BL-034 Gemini Provider Modernization and Google Compatibility

- **Status**: completed
- **Created**: 2026-05-01
- **Branch**: feat/gemini-provider-modernization
- **Merged PR**: #117
- **Scope**: packages/agent-provider-google, packages/agent-core, packages/agent-cli, docs

## Objective

Modernize Robota's Gemini API provider path while preserving compatibility for existing `google` provider profiles. The first implementation slice makes `gemini` the canonical provider type exposed through provider definitions, keeps `google` as a compatibility alias, and avoids concrete provider-name branches in CLI/SDK generic layers.

## Problem

`agent-provider-google` currently owns Gemini API integration, Gemini message conversion, Gemini function declaration conversion, and Gemini image-capable model behavior. As Robota adds separate model-family providers such as Gemma, the package name `google` becomes ambiguous because Google can mean product platform, model family, or API vendor.

Renaming directly would affect imports, package documentation, CLI provider type names, package publishing, and downstream user code. This must be handled as its own migration rather than bundled into Gemma provider implementation.

## Recommended Direction

- Introduce `agent-provider-gemini` as the canonical package for Google Gemini API behavior.
- Keep `agent-provider-google` as a compatibility package for at least one migration window.
- Decide whether compatibility means a thin wrapper re-export package, duplicated package entry, or deprecation-only documentation.
- Keep `agent-provider-gemma` separate from `agent-provider-gemini`; Gemma served through LM Studio/OpenAI-compatible APIs should not be owned by the Gemini API provider.
- Let CLI support `type: "gemini"` as the canonical future provider type while preserving `type: "google"` during migration if backwards compatibility is required.

## Official Documentation Research

- Google documents the Google GenAI SDK (`@google/genai`) as the recommended, production-ready Gemini API SDK and marks the legacy JavaScript SDK (`@google/generative-ai`) as not actively maintained.
  - Source: <https://ai.google.dev/gemini-api/docs/libraries>
- Gemini direct API text generation uses `models.generateContent` / `models.generateContentStream`, with system instruction, thinking, multimodal content, and generation config support.
  - Source: <https://ai.google.dev/gemini-api/docs/text-generation>
- Gemini OpenAI compatibility is officially supported through `https://generativelanguage.googleapis.com/v1beta/openai/`, but Google recommends calling the Gemini API directly when not already using OpenAI libraries.
  - Source: <https://ai.google.dev/gemini-api/docs/openai>
- Gemini function calling supports tool declarations and function-calling modes (`AUTO`, `ANY`, `NONE`, `VALIDATED` preview).
  - Source: <https://ai.google.dev/gemini-api/docs/function-calling>
- Gemini structured outputs support JSON schema and streaming partial JSON.
  - Source: <https://ai.google.dev/gemini-api/docs/structured-output>

## Completed Slice Decision

- Do not create `agent-provider-gemini` in this slice. Creating a new canonical package and turning `agent-provider-google` into a compatibility wrapper requires a publish and semver migration plan.
- Add a provider-definition alias mechanism in the shared provider-definition contract so compatibility names are resolved generically.
- Export a Gemini provider definition from the current Google/Gemini provider package with canonical `type: "gemini"` and compatibility alias `google`.
- Add the Gemini provider definition to the CLI composition root. CLI may import and inject the provider definition, but generic provider resolution must not branch on `gemini` or `google`.
- Migrate the direct Gemini transport from legacy `@google/generative-ai` to the official GA `@google/genai` SDK after provider-type compatibility is covered by tests.
- Track the package-level rename to a future `@robota-sdk/agent-provider-gemini` package separately in `CLI-BL-043`, because it affects package names, publish policy, compatibility imports, and semver.

## Plan

- [x] Audit current `agent-provider-google` public exports, docs, examples, and CLI references.
- [x] Decide the migration style: wrapper package, package rename with compatibility alias, or documentation-only deprecation.
- [x] Define package dependency direction so compatibility wrappers do not create cycles.
- [x] Update package SPEC files before code changes.
- [x] Add CLI settings tests for canonical and compatibility provider type names.
- [x] Update documentation and changelog migration notes.
- [x] Run package build/test/typecheck and harness scans.
- [x] Add provider-definition alias support in the generic provider composition contract.
- [x] Add `createGeminiProviderDefinition()` with `google` compatibility alias.
- [x] Add default CLI Gemini provider composition without provider-name-specific CLI branches.
- [x] Add RED tests proving direct transport uses `@google/genai`, `config`, and async-iterable streaming.
- [x] Replace legacy `@google/generative-ai` dependency and transport calls with `@google/genai`.
- [x] Preserve Gemini tool call IDs when the API returns them.
- [x] Update provider docs/specs to describe the GenAI SDK transport.
- [x] Run targeted provider tests, build, typecheck, lint, and harness scan.

## Test Plan

- Given existing user code imports `@robota-sdk/agent-provider-google`, when the compatibility plan is implemented, then documented migration behavior remains valid and tested.
- Given a new user config selects `type: "gemini"`, when the CLI creates a provider, then it uses the Gemini API provider implementation.
- Given an existing config selects `type: "google"`, when compatibility support is enabled, then the CLI either creates the same provider or emits the documented migration error.
- Given provider definitions include aliases, when generic provider resolution receives an alias, then it resolves to the owning definition without CLI/SDK provider-specific branching.
- Given package specs are updated, when `pnpm harness:scan:specs` runs, then the new or renamed package is covered by `docs/SPEC.md`.
- Given dependency-direction checks run, when compatibility packages depend on canonical packages, then no bidirectional workspace dependency is introduced.
- Given the provider is constructed without an executor, when direct chat is executed, then it must instantiate `GoogleGenAI` and call `models.generateContent` with `model`, `contents`, and `config`.
- Given direct streaming chat is executed, when `@google/genai` returns an async iterable from `models.generateContentStream`, then Robota yields each text chunk without expecting the legacy `{ stream }` wrapper or `chunk.text()` method.
- Given Gemini returns function calls with provider IDs, when converting the response to `TUniversalMessage`, then Robota preserves the returned function call `id` as the universal `toolCall.id`.

## Decisions

- Do not bundle this rename with `CLI-BL-033`; Gemma provider work and Gemini rename work have different compatibility risks.
- Treat `agent-provider-gemini` as the more accurate long-term name for Google Gemini API behavior.
- Treat `agent-provider-gemma` as a separate model-family provider for local/OpenAI-compatible servers.

## Progress

### 2026-05-01

- Created as a follow-up from Gemma provider package-boundary discussion.

### 2026-05-02

- Started implementation on `feat/gemini-provider-modernization`.
- Completed official Gemini API documentation research before code changes.
- Chose a compatibility-first implementation slice: canonical provider type `gemini`, alias `google`, and generic alias resolution through `IProviderDefinition`.
- Added generic provider-definition alias tests, Gemini provider-definition tests, and CLI provider-factory tests for canonical `gemini` and compatibility `google`.
- Implemented `IProviderDefinition.aliases`, `createGeminiProviderDefinition()`, default CLI Gemini composition, and documentation updates.
- Promoted `agent-provider-google` to a publishable package because `agent-cli` now depends on it for default provider composition.
- Verified targeted tests, typecheck, lint, package builds, and `pnpm harness:scan`.
- Started the second implementation slice for direct transport migration to `@google/genai`.
- Confirmed RED failure with `pnpm --filter @robota-sdk/agent-provider-google test -- genai-transport`; the current code still constructs legacy `GoogleGenerativeAI`.
- Migrated direct transport to `GoogleGenAI` with `models.generateContent`, `models.generateContentStream`, request `config.tools`, and async-iterable streaming.
- Updated message conversion to preserve Gemini function call IDs and convert Robota JSON schema parameter types into GenAI SDK `Type` enum values.
- Re-ran provider tests, provider typecheck, provider build, provider lint, and CLI provider-factory tests after migration.
- Split Gemini tool schema conversion into `tool-schema-converter.ts` after harness file-size scan showed `message-converter.ts` exceeded the 300-line limit.
- Verified `pnpm harness:scan`; file-size warnings returned to the pre-existing 55-file set and no new oversized file remains from this slice.

### Post-Merge Current State

- PR #117 merged the compatibility-first Gemini modernization into `develop`.
- The workspace still contains `@robota-sdk/agent-provider-google`; no `packages/agent-provider-gemini` package exists yet.
- `createGeminiProviderDefinition()` is exported from `@robota-sdk/agent-provider-google` with canonical `type: "gemini"` and compatibility alias `google`.
- CLI default provider composition injects the Gemini provider definition through the generic provider-definition contract.
- Direct Gemini transport now uses `@google/genai`; the legacy `@google/generative-ai` transport is no longer the implementation path.
- The remaining rename/compatibility-package work is tracked as `CLI-BL-043 Gemini Provider Package Rename Compatibility Migration`.

## Blockers

- None for this completed modernization slice.
- Full package rename to `agent-provider-gemini` remains future work and is tracked separately.

## Result

Completed and merged through PR #117. This slice made `gemini` the canonical provider type, kept `google` as a compatibility alias, moved direct Gemini transport to `@google/genai`, and kept generic CLI/SDK layers branch-free through provider definitions. The package-level rename to a future `@robota-sdk/agent-provider-gemini` package is intentionally deferred to `CLI-BL-043`.
