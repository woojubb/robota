# CLI-BL-033 Gemma Provider and OpenAI-Compatible Transport Reuse

- **Status**: todo
- **Created**: 2026-05-01
- **Branch**: feat/agent-invocation-router
- **Scope**: packages/agent-provider-gemma, packages/agent-provider-google, packages/agent-provider-openai, packages/agent-sdk, packages/agent-cli

## Objective

Design and implement a first-class Gemma provider path for Robota instead of relying on local user-side LM Studio tweaks or ad hoc OpenAI-compatible post-processing. Robota should provide a consistent, general-purpose environment for non-expert users while keeping model-family behavior out of the generic OpenAI-compatible provider.

## Problem

Gemma 4 models can use a model-native Jinja chat template that emits reasoning-channel markers such as `<|channel>thought` and `<channel|>`. In LM Studio, these markers may leak into streamed assistant content when the serving layer does not parse them as reasoning sections.

Robota should not solve this by asking every user to manually edit LM Studio templates, nor by adding `if gemma` branches to the generic OpenAI-compatible provider. The system needs a composable provider architecture where model-family behavior is opt-in, explicit, and reusable.

## Plan

- [ ] Research whether Gemma should be implemented as a dedicated `agent-provider-gemma` package or as a Gemma-specific module under the existing Google provider.
- [ ] Extract OpenAI-compatible transport pieces from `agent-provider-openai` into a reusable internal module or package so local providers can share request, streaming, tool schema conversion, and response parsing infrastructure.
- [ ] Define a Gemma provider contract that owns Gemma chat-template assumptions, reasoning-channel parsing, tool-call parsing expectations, and compatibility notes for LM Studio, vLLM, and other OpenAI-compatible servers.
- [ ] Keep `agent-provider-openai` model-family neutral. It must not contain Gemma-specific marker filtering or model-name heuristics.
- [ ] Add CLI configuration support for selecting the Gemma provider explicitly while still pointing at an OpenAI-compatible base URL.
- [ ] Add unit tests for Gemma reasoning marker parsing, streamed content projection, and provider composition with shared OpenAI-compatible transport.
- [ ] Add integration or replay tests using captured `.robota/logs` samples where Gemma emits reasoning-channel markers in streamed deltas.
- [ ] Update package SPEC files and user docs so provider selection and supported local-model behavior are clear.

## Decisions

- Robota should not choose the easiest local workaround as the product direction. Manual LM Studio Reasoning Parsing or prompt-template edits may be useful diagnostics, but they are not the primary product solution.
- The generic OpenAI-compatible provider should remain transport-oriented and model-family neutral.
- A dedicated `agent-provider-gemma` package is preferred unless research shows that the existing Google provider is the cleaner ownership boundary for Gemma-local behavior.
- Any Gemma-specific behavior must be explicit through provider selection or an equivalent typed configuration, not inferred from model name strings.
- Shared OpenAI-compatible transport code should be composable so future model-family providers can reuse it without copy-pasting the OpenAI provider.

## Test Plan

- Given Gemma reasoning-channel markers arrive in streamed deltas, when the Gemma provider is selected, then user-facing streamed text excludes reasoning markers while diagnostic logs retain raw provider data.
- Given the same response arrives through the generic OpenAI-compatible provider, when no Gemma provider/profile is selected, then Robota does not apply Gemma-specific filtering.
- Given a local LM Studio endpoint is configured with the Gemma provider, when Robota creates a session, then tool schemas, streaming, and background subagent logging still work through the shared OpenAI-compatible transport layer.
- Given shared transport code is extracted, when `agent-provider-openai` builds and tests run, then existing OpenAI-compatible behavior remains unchanged.
- Given Gemma provider docs are generated, when a non-expert user follows the provider setup, then no manual prompt-template editing is required for the default supported path.

## Progress

### 2026-05-01

- Backlog created after Gemma 4 LM Studio investigation showed reasoning-channel markers are model-template/serving behavior rather than Robota prompt content.

## Blockers

- Need an architectural decision on whether Gemma ownership belongs in a new `agent-provider-gemma` package or under `agent-provider-google`.
- Need to identify the right shared transport boundary before extracting code from `agent-provider-openai`.

## Result

Not started.
