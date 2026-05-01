# Gemini Provider Modernization

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

- [ ] Provider package naming and compatibility strategy are documented.
- [ ] Gemini API request/response conversion matches current official API behavior.
- [ ] SDK examples show how to compose Gemini support explicitly.
- [ ] CLI can use Gemini provider definitions without hardcoded generic execution branches.
- [ ] Existing users of `agent-provider-google` receive either compatible behavior or a documented migration error.
- [ ] Unit tests cover Gemini streaming, tool calling, structured output, config validation, and error mapping.

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
