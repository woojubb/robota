# CLI-BL-033 Gemma Provider and OpenAI-Compatible Transport Reuse

- **Status**: todo
- **Created**: 2026-05-01
- **Branch**: TBD
- **Scope**: packages/agent-provider-gemma, packages/agent-provider-openai-compatible, packages/agent-provider-openai, packages/agent-provider-google, packages/agent-provider-gemini, packages/agent-cli

## Objective

Design and implement a first-class Gemma provider path for Robota instead of relying on local user-side LM Studio tweaks or ad hoc OpenAI-compatible post-processing. Robota should provide a consistent, general-purpose environment for non-expert users while keeping model-family behavior out of the generic OpenAI-compatible provider.

## Problem

Gemma 4 models can use a model-native Jinja chat template that emits reasoning-channel markers such as `<|channel>thought` and `<channel|>`. In LM Studio, these markers may leak into streamed assistant content when the serving layer does not parse them as reasoning sections.

Robota should not solve this by asking every user to manually edit LM Studio templates, nor by adding `if gemma` branches to the generic OpenAI-compatible provider. The system needs a composable provider architecture where model-family behavior is opt-in, explicit, and reusable.

## Plan

- [x] Research whether Gemma should be implemented as a dedicated `agent-provider-gemma` package or as a Gemma-specific module under the existing Google provider.
- [x] Define the recommended package boundary and future provider naming direction.
- [ ] Extract OpenAI-compatible transport pieces from `agent-provider-openai` into a reusable package so local providers can share request, streaming, tool schema conversion, and response parsing infrastructure.
- [ ] Define a Gemma provider contract that owns Gemma chat-template assumptions, reasoning-channel parsing, tool-call parsing expectations, and compatibility notes for LM Studio and other OpenAI-compatible servers.
- [ ] Keep `agent-provider-openai` model-family neutral. It must not contain Gemma-specific marker filtering or model-name heuristics.
- [ ] Add CLI configuration support for selecting the Gemma provider explicitly while still pointing at an OpenAI-compatible base URL.
- [ ] Add unit tests for Gemma reasoning marker parsing, streamed content projection, and provider composition with shared OpenAI-compatible transport.
- [ ] Add integration or replay tests using captured `.robota/logs` samples where Gemma emits reasoning-channel markers in streamed deltas.
- [ ] Update package SPEC files and user docs so provider selection and supported local-model behavior are clear.

## Decisions

- Robota should not choose the easiest local workaround as the product direction. Manual LM Studio Reasoning Parsing or prompt-template edits may be useful diagnostics, but they are not the primary product solution.
- The generic OpenAI-compatible provider should remain transport-oriented and model-family neutral.
- A dedicated `agent-provider-gemma` package is the recommended ownership boundary. `agent-provider-google` currently owns Gemini API behavior, while local Gemma models served through LM Studio use OpenAI-compatible Chat Completions transport.
- Any Gemma-specific behavior must be explicit through provider selection or an equivalent typed configuration, not inferred from model name strings.
- Shared OpenAI-compatible transport code should be composable so future model-family providers can reuse it without copy-pasting the OpenAI provider.
- Existing provider package names and boundaries may be changed in future migrations. The Gemma work should not assume today's `agent-provider-google` naming is permanent.

## Recommended Package Boundary

| Package                            | Recommended role                                                | Notes                                                                                                                                                                                                                                                                |
| ---------------------------------- | --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `agent-provider-openai-compatible` | Shared OpenAI-compatible Chat Completions transport primitives  | Owns message conversion, tool schema conversion, stream assembly, response parsing, request option helpers, and model-neutral transport types. It is a building block, not the end-user "OpenAI" provider brand.                                                     |
| `agent-provider-openai`            | OpenAI-branded provider                                         | Uses the shared OpenAI-compatible transport package. Owns OpenAI account/product semantics, OpenAI defaults, OpenAI-specific options, payload logging surface, and public `OpenAIProvider` compatibility. Must stay model-family neutral.                            |
| `agent-provider-gemma`             | Gemma model-family provider for local/OpenAI-compatible servers | Uses the shared OpenAI-compatible transport package. Owns Gemma chat-template assumptions, reasoning-channel marker projection, Gemma-specific documentation, and explicit local model setup guidance.                                                               |
| `agent-provider-google`            | Current Google/Gemini provider package                          | Keep as-is during the Gemma work to avoid combining unrelated migrations. It currently owns Google Gemini API and image-generation behavior.                                                                                                                         |
| `agent-provider-gemini`            | Future rename target for Google Gemini API provider             | Consider creating this as the canonical Gemini API package later, with `agent-provider-google` becoming a compatibility package or deprecated alias. This should be a separate migration backlog because it affects package names, docs, imports, and semver policy. |
| `agent-cli`                        | Composition root for user-selected providers                    | CLI may know which concrete provider packages are installed and wire them from settings. SDK/core should not need hardcoded knowledge of Gemma, Gemini, or OpenAI provider packages.                                                                                 |

## Recommended Sequencing

1. Extract `agent-provider-openai-compatible` from the reusable parts of `agent-provider-openai`.
2. Refactor `agent-provider-openai` to consume the shared transport without changing its public behavior.
3. Add `agent-provider-gemma` using the shared transport and Gemma-specific streaming/content projection.
4. Add explicit CLI settings support for `type: "gemma"` with local OpenAI-compatible endpoint options.
5. Add a separate backlog item for `agent-provider-google` -> `agent-provider-gemini` package migration and compatibility strategy.

## Gemini Naming Migration Note

The current `agent-provider-google` package name is broader than its actual provider responsibility. Its implementation is centered on Gemini API behavior, including Gemini message conversion and image-capable model handling. Long term, `agent-provider-gemini` would communicate ownership more accurately.

This rename should not be bundled into the Gemma provider implementation. It should be handled as a compatibility migration with a clear plan for:

- whether `agent-provider-google` remains as a wrapper package;
- how import paths are documented during the transition;
- whether package exports are duplicated or redirected;
- how changelog and semver impact are handled;
- whether CLI provider type names should use `google`, `gemini`, or both during migration.

## Test Plan

- Given Gemma reasoning-channel markers arrive in streamed deltas, when the Gemma provider is selected, then user-facing streamed text excludes reasoning markers while diagnostic logs retain raw provider data.
- Given the same response arrives through the generic OpenAI-compatible provider, when no Gemma provider/profile is selected, then Robota does not apply Gemma-specific filtering.
- Given a local LM Studio endpoint is configured with the Gemma provider, when Robota creates a session, then tool schemas, streaming, and background subagent logging still work through the shared OpenAI-compatible transport layer.
- Given shared transport code is extracted, when `agent-provider-openai` builds and tests run, then existing OpenAI-compatible behavior remains unchanged.
- Given Gemma provider docs are generated, when a non-expert user follows the provider setup, then no manual prompt-template editing is required for the default supported path.

## Progress

### 2026-05-01

- Backlog created after Gemma 4 LM Studio investigation showed reasoning-channel markers are model-template/serving behavior rather than Robota prompt content.
- Captured the recommended package boundary: shared OpenAI-compatible transport package, dedicated Gemma provider package, and a future Gemini rename path for the current Google provider.

## Blockers

- Need to decide whether `agent-provider-openai-compatible` should expose only pure conversion/streaming helpers or also a thin reusable provider base class.
- Need a separate backlog item before renaming `agent-provider-google` to `agent-provider-gemini`.

## Result

Not started.
