# OpenAI Provider Modernization

## What

Modernize Robota's OpenAI provider and SDK/CLI composition path against the current OpenAI API surface.

## Why

The OpenAI provider is one of Robota's core integration paths, but it must stay aligned with current OpenAI API behavior while remaining separate from generic OpenAI-compatible transport. Users should be able to select OpenAI through CLI and SDK composition without generic layers carrying OpenAI-specific branches.

## Research Required

Before implementation, research current official OpenAI API documentation. Confirm:

- recommended API surface for chat, responses, or equivalent model calls;
- streaming event semantics;
- tool/function calling behavior;
- structured output support;
- reasoning or hidden-chain-of-thought handling rules;
- multimodal support relevant to Robota;
- error format, rate limits, retry guidance, and model capability metadata.

Use official OpenAI documentation as the source of truth.

## Scope

- Audit current `agent-provider-openai` behavior against the current API.
- Decide which API surface the provider should target and how it composes with `agent-provider-openai-compatible`.
- Keep OpenAI-branded behavior in `agent-provider-openai`.
- Keep transport-neutral OpenAI-compatible primitives in `agent-provider-openai-compatible`.
- Update SDK and CLI examples to show explicit OpenAI provider composition.
- Add tests for streaming, tool calling, structured outputs, error mapping, and provider setup.

## Non-Goals

- Do not put OpenAI-specific API behavior into `agent-core`, generic `agent-sdk`, or CLI execution loops.
- Do not make `agent-provider-openai-compatible` depend on OpenAI-branded account/product semantics.
- Do not infer behavior from model-name strings in generic layers.

## Acceptance Criteria

- [ ] Current OpenAI API research is recorded before implementation begins.
- [ ] Provider package SPEC documents the selected API surface and unsupported capabilities.
- [ ] OpenAI provider behavior remains model-family neutral unless OpenAI docs define provider-level behavior.
- [ ] SDK examples show OpenAI provider composition without SDK core hardcoding OpenAI.
- [ ] CLI setup can select OpenAI through injected provider definitions.
- [ ] Unit tests cover streaming, tool calling, structured outputs, setup validation, and error mapping.

## Risks & Mitigations

| Risk                                             | Mitigation                                                       |
| ------------------------------------------------ | ---------------------------------------------------------------- |
| OpenAI API surface changes faster than provider  | Isolate API mapping behind provider-owned adapters and tests     |
| OpenAI-compatible transport becomes OpenAI-only  | Keep branded provider semantics separate from shared transport   |
| SDK/CLI generic layers regain provider branching | Enforce provider-definition composition and add regression tests |

## Promotion Path

1. Move to `.agents/tasks/CLI-BL-0XX-openai-provider-modernization.md`.
2. Complete official OpenAI API research before writing the implementation spec.
3. Update provider and SDK specs before code changes.
