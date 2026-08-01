# Gemini Provider Modernization

- **Status**: completed
- **Created**: 2026-05-03
- **Branch**: feat/gemini-api-modernization
- **Scope**: packages/agent-provider-gemini, packages/agent-provider-google, provider docs/content

## What

Modernize Robota's Gemini API support and make Gemini provider composition clear for SDK and CLI users.

## Why

The existing Google/Gemini provider path predates the current provider-composition direction. Robota should expose Gemini API support through a clear provider boundary, current API behavior, and SDK/CLI composition patterns that do not require generic layers to know Gemini-specific details.

## Relationship to Existing Work

This backlog is related to `.agents/tasks/CLI-BL-034-google-provider-gemini-rename.md`, but it is broader than package naming. The rename migration can be one part of this work, while provider modernization must also cover current Gemini API capabilities, SDK examples, CLI setup, tests, and documentation.

## Research Required

Before implementation, research current official Gemini API documentation and SDK behavior. Confirm:

- current recommended API surface and authentication;
- chat/content generation request and response shapes;
- streaming semantics;
- tool/function calling support;
- structured output support;
- multimodal input/output behavior relevant to Robota;
- error format, rate limits, safety settings, and retry guidance.

Use official documentation as the source of truth for implementation decisions.

## Scope

- Decide whether `agent-provider-gemini` becomes the canonical package and whether `agent-provider-google` remains as a compatibility wrapper.
- Update provider implementation to current Gemini API behavior.
- Expose Gemini provider composition for SDK users without making SDK core depend on Gemini.
- Update CLI setup so users can select Gemini through injected provider definitions.
- Update docs, examples, changelog, and migration notes.
- Add tests for streaming, tool calling, structured output, and provider setup behavior.

## Non-Goals

- Do not bundle Gemma local-model behavior into the Gemini API provider.
- Do not add Gemini-specific branches to generic CLI, SDK, or core execution layers.
- Do not remove existing `agent-provider-google` compatibility without a documented migration plan.

## Acceptance Criteria

- [x] Provider package naming and compatibility strategy are documented.
- [x] Gemini API request/response conversion matches current official API behavior.
- [x] SDK examples show how to compose Gemini support explicitly.
- [x] CLI can use Gemini provider definitions without hardcoded generic execution branches.
- [x] Existing users of `agent-provider-google` receive either compatible behavior or a documented migration error.
- [x] Unit tests cover Gemini streaming, tool calling, structured output, config validation, and error mapping.

## Plan

- [x] Move backlog item into active task tracking.
- [x] Research current official Gemini API and Google GenAI SDK behavior.
- [x] Implement remaining provider conversion/configuration gaps.
- [x] Update provider docs, SPEC, and user-facing content.
- [x] Run targeted provider and wrapper verification.
- [x] Run root monorepo build/docs/harness verification.
- [x] Open PR to `develop`, wait for CI, and merge.

## Progress

### 2026-05-03

- Prioritized this task after OpenAI provider modernization because it is the next concrete provider API modernization backlog.
- Confirmed existing work already made `agent-provider-gemini` the canonical package, kept `agent-provider-google` as a compatibility wrapper, and wired CLI setup through provider definitions.
- Researched current official Gemini documentation and local `@google/genai` typings before implementation.
- Implemented provider default model fallback, request-level `systemInstruction`, Gemini `functionResponse` tool result conversion, structured output config, safety settings, thinking config, abort signal pass-through, and `onTextDelta` streaming assembly.
- Split request conversion into `request-converter.ts` to avoid adding a new file-size warning in the existing message response converter.
- Updated package docs, Google compatibility README, current content docs, and changeset metadata.
- Verified targeted package tests/typecheck/lint/build, root `pnpm build`, `pnpm docs:build`, and `pnpm harness:scan`.

## Decisions

- Keep `@robota-sdk/agent-provider-gemini` as the canonical package and keep `@robota-sdk/agent-provider-google` as a compatibility wrapper.
- Use `@google/genai` `GoogleGenAI` with `models.generateContent()` and `models.generateContentStream()` as the direct transport.
- Map Robota system messages to Gemini `config.systemInstruction` rather than regular user `contents`.
- Support provider-level `defaultModel` because provider definitions already inject it and direct calls should not require duplicated per-call models.
- Pass structured output, safety, and thinking options through Gemini `config` so SDK users can use current API features without CLI/SDK core branches.

## Research Notes

- Official text generation docs show JavaScript usage through `GoogleGenAI` and `ai.models.generateContent({ model, contents, config })`, with system instructions supplied as `config.systemInstruction`.
- Official API reference describes `contents` as a list of conversation `Content` turns and streaming as a stream of `GenerateContentResponse` instances.
- Official function calling docs use `config.tools` with `functionDeclarations` and optional `toolConfig`.
- Official structured output docs support `responseMimeType` and `responseSchema`; streamed chunks are valid partial JSON strings that can be concatenated.
- Official image generation docs use `responseModalities: [TEXT, IMAGE]` for Gemini native image generation.
- Official safety docs support request-level `safetySettings`.
- Official troubleshooting/rate-limit docs identify common error statuses, including `INVALID_ARGUMENT`, `PERMISSION_DENIED`, `RESOURCE_EXHAUSTED`, `INTERNAL`, `UNAVAILABLE`, and `DEADLINE_EXCEEDED`.

## Test Plan

- Run targeted Gemini provider tests, typecheck, lint, and build after changing direct request conversion and option mapping.
- Run Google compatibility wrapper tests, typecheck, and build because `agent-provider-google` re-exports Gemini provider behavior and types.
- Run root `pnpm build` from the workspace root to verify the monorepo build path once all package-level checks pass.
- Run `pnpm docs:build` and `pnpm harness:scan` to validate content docs, package SPEC coverage, publish safety checks, and repository guidance checks.

## Blockers

- None.

## Result

Gemini direct API behavior now matches the current Google GenAI request model more closely: system messages are sent as `config.systemInstruction`, tool outputs are sent as `functionResponse`, provider defaults can supply a model for direct calls, and Gemini config supports structured output, safety, thinking, abort signals, and streaming text callbacks. The Google provider package remains a compatibility wrapper with updated migration guidance.

## Risks & Mitigations

| Risk                                       | Mitigation                                                                   |
| ------------------------------------------ | ---------------------------------------------------------------------------- |
| Rename breaks downstream imports           | Use compatibility wrapper or migration window                                |
| SDK gains concrete provider dependencies   | Keep provider support as opt-in composition and examples                     |
| Gemini and Gemma boundaries become blurred | Keep Gemini API provider and Gemma local/OpenAI-compatible provider separate |

## Promotion Path

1. Coordinate with `CLI-BL-034`.
2. Move to `.agents/tasks/CLI-BL-0XX-gemini-provider-modernization.md` when prioritized.
3. Complete official API research before implementation spec is finalized.
