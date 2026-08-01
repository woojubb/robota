# OpenAI Provider Modernization

- **Status**: completed
- **Created**: 2026-05-03
- **Branch**: feat/openai-provider-modernization
- **Scope**: packages/agent-provider-openai, packages/agent-cli, content, .agents

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

## Research Record

Sources checked before implementation:

- <https://platform.openai.com/docs/guides/responses-vs-chat-completions>
- <https://platform.openai.com/docs/guides/chat-completions>
- <https://platform.openai.com/docs/api-reference/chat/create/>
- <https://platform.openai.com/docs/guides/structured-outputs>
- <https://platform.openai.com/docs/guides/function-calling>
- <https://platform.openai.com/docs/guides/streaming-responses>
- <https://platform.openai.com/docs/guides/rate-limits>
- <https://platform.openai.com/docs/guides/error-codes>

Findings:

- OpenAI recommends the Responses API for new projects while Chat Completions remains supported.
- Responses uses typed output items rather than chat `choices`, and custom function calls are `function_call` output items correlated by `call_id`.
- Responses streaming uses semantic SSE events such as `response.output_text.delta`, `response.output_item.done`, `response.completed`, `response.failed`, and `response.error`.
- Structured Outputs on Responses use `text.format`; Chat Completions uses `response_format`.
- OpenAI reasoning internals must not be exposed as hidden chain-of-thought. Only explicit reasoning summaries or encrypted reasoning items should be represented as metadata if enabled by request options.
- Responses is the OpenAI-branded surface for native multimodal and built-in tool features. OpenAI-compatible endpoints should stay on Chat Completions unless they explicitly document Responses support.
- OpenAI rate-limit guidance recommends reading response headers and using bounded exponential backoff with jitter for retryable 429/5xx conditions. This task records the taxonomy and preserves error wrapping; retry policy remains caller-owned until a cross-provider retry contract exists.

## Recommendation

Implement the OpenAI-branded provider as Responses-first by default for official OpenAI API calls, while preserving Chat Completions for explicit `apiSurface: "chat-completions"` and for profiles with `baseURL` configured. This avoids breaking OpenAI-compatible local endpoints and keeps OpenAI-specific Responses behavior out of `agent-provider-openai-compatible`.

## Plan

- [x] Research current official OpenAI API behavior before implementation.
- [x] Decide API-surface strategy and record the recommendation.
- [x] Update OpenAI provider SPEC with Responses-first behavior and Chat Completions compatibility.
- [x] Add Responses input conversion, tool conversion, structured output request mapping, response parsing, and stream assembly.
- [x] Route OpenAI provider calls through Responses by default and Chat Completions for OpenAI-compatible/baseURL profiles.
- [x] Update provider setup definition and CLI tests so OpenAI setup is official OpenAI, not LM Studio-flavored OpenAI-compatible.
- [x] Update SDK/content examples to show explicit OpenAI provider composition.
- [x] Add unit tests for streaming, tool calling, structured outputs, setup validation, and error mapping.
- [x] Run targeted package tests, CLI affected tests, typecheck, lint, root build, docs build, and harness scan.
- [x] Prepare the branch for PR creation and CI merge into `develop`.

## Scope

- Audit current `agent-provider-openai` behavior against the current API.
- Decide which API surface the provider should target and how it composes with `agent-provider-openai-compatible`.
- Keep OpenAI-branded behavior in `agent-provider-openai`.
- Keep transport-neutral OpenAI-compatible primitives in `agent-provider-openai-compatible`.
- Update SDK and CLI examples to show explicit OpenAI provider composition.
- Add tests for streaming, tool calling, structured outputs, error mapping, and provider setup.

## Test Plan

- Run `pnpm --filter @robota-sdk/agent-provider-openai test`, `typecheck`, `lint`, and `build` to verify provider behavior and package output.
- Run targeted `@robota-sdk/agent-cli` provider setup tests and `typecheck`/`lint` to verify injected provider definition behavior.
- Run root `pnpm build`, `pnpm docs:build`, and `pnpm harness:scan` before PR creation to catch monorepo, docs, and repository rule regressions.

## Non-Goals

- Do not put OpenAI-specific API behavior into `agent-core`, generic `agent-sdk`, or CLI execution loops.
- Do not make `agent-provider-openai-compatible` depend on OpenAI-branded account/product semantics.
- Do not infer behavior from model-name strings in generic layers.

## Acceptance Criteria

- [x] Current OpenAI API research is recorded before implementation begins.
- [x] Provider package SPEC documents the selected API surface and unsupported capabilities.
- [x] OpenAI provider behavior remains model-family neutral unless OpenAI docs define provider-level behavior.
- [x] SDK examples show OpenAI provider composition without SDK core hardcoding OpenAI.
- [x] CLI setup can select OpenAI through injected provider definitions.
- [x] Unit tests cover streaming, tool calling, structured outputs, setup validation, and error mapping.

## Progress

### 2026-05-03

- Recorded official OpenAI API research and selected a Responses-first strategy for official OpenAI profiles.
- Added provider-owned Responses request, conversion, parsing, stream assembly, and type modules.
- Preserved Chat Completions compatibility for explicit `apiSurface: "chat-completions"` and `baseURL` profiles.
- Updated OpenAI provider setup so CLI configuration prompts for official OpenAI model/API key rather than LM Studio-style defaults.
- Updated SDK/content and package docs to describe official OpenAI provider composition and compatibility mode.
- Verified provider tests, typecheck, lint, package build, CLI affected tests, CLI typecheck/lint, docs build, root build, and harness scan.

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

## Result

Implemented the OpenAI provider as Responses-first for official OpenAI profiles, preserved Chat Completions for `baseURL` and explicit compatibility profiles, updated CLI setup and docs, and added regression coverage for Responses streaming, tool calls, structured outputs, setup validation, and compatibility routing.
