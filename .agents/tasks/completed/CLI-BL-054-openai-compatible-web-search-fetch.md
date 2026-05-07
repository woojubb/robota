# OpenAI-Compatible Web Search and Fetch Support

- **Status**: completed
- **Created**: 2026-05-04
- **Branch**: feat/openai-compatible-web-capabilities
- **Scope**: packages/agent-core, packages/agent-provider-openai-compatible, packages/agent-cli, content

## Objective

Add explicit provider capability handling for native web search and fetch when an OpenAI-compatible provider such as LM Studio is selected. The implementation must avoid hidden fallback behavior, preserve existing Anthropic behavior, and make unsupported capability failures clear before request execution.

## Plan

- [x] Research LM Studio and provider-native web search/fetch behavior using primary documentation.
- [x] Inspect existing CLI, SDK, core, Anthropic, and OpenAI-compatible provider paths that can expose search/fetch.
- [x] Write `docs/plans/2026-05-04-openai-compatible-web-capabilities-design.md` with goal, architecture, data flow, affected files, and test strategy.
- [x] Update governing SPEC documents before production code changes.
- [x] Add failing tests for capability reporting and unsupported native web capability errors.
- [x] Implement provider-agnostic capability contracts and OpenAI-compatible explicit behavior.
- [x] Update CLI/user-facing documentation and robota.io source content.
- [x] Run targeted package verification, docs build, root build/test/typecheck/lint, and harness scan.
- [x] Prepare a PR into `develop` after local verification.

## Test Strategy

Unit tests will cover provider capability metadata, OpenAI-compatible default native web search/fetch unsupported behavior, explicit compatible capability configuration, and pre-request failure for native web tool options. Regression tests will confirm Anthropic behavior remains unchanged if touched. Verification commands will include targeted package test/typecheck/lint/build for affected packages, `pnpm docs:build`, root `pnpm build`, `pnpm test`, `pnpm typecheck`, `pnpm lint`, and `pnpm harness:scan`.

## Progress

### 2026-05-04

- Moved backlog item into active task tracking.
- Created feature branch `feat/openai-compatible-web-capabilities` from `develop`.
- Researched LM Studio/OpenAI official docs and wrote the spec-first design document.
- Updated `agent-core`, provider, sessions, SDK, CLI, and content specs/docs with the intended capability contract before production code changes.
- Added provider capability contracts, provider-owned native web enablement/reporting, explicit OpenAI-compatible unsupported behavior, local WebFetch/WebSearch permission alignment, and targeted regression tests.
- Completed targeted builds/tests, docs build, root build/test/typecheck/lint, and harness scan for the final local state.

## Decisions

- Use one feature branch and PR for this backlog, targeting `develop`.
- Do not add hidden fallback from provider-native web search/fetch to Robota local tools. Local `WebSearch`/`WebFetch` remain ordinary function tools; provider-native tools must be advertised and enabled explicitly by provider-owned capability contracts.
- Treat LM Studio/OpenAI-compatible Chat Completions as custom-function-tool capable but native web search/fetch unsupported unless a concrete provider documents and implements a hosted web capability.

## Blockers

- None.

## Result

- Added provider-neutral native web capability contracts and default unsupported behavior in `agent-core`.
- Preserved provider-owned hosted web behavior for Anthropic/Qwen while making OpenAI-compatible/LM Studio and Gemma endpoints explicitly report native web search/fetch as unsupported.
- Updated session setup/logging to use generic provider capability hooks and removed provider-name branching for native web enablement.
- Aligned local `WebFetch`/`WebSearch` as ordinary read-only Robota tools in permission policy, SDK tool descriptions, CLI docs, and robota.io content.
- Added changeset and regression coverage for provider capabilities, unsupported native web requests, session lifecycle setup, provider definitions, local tool descriptions, and permission policy.

## Prior Art Research

- LM Studio OpenAI compatibility documents OpenAI-compatible endpoints and base URL switching, but not provider-native web search/fetch for OpenAI-compatible Chat Completions: <https://lmstudio.ai/docs/developer/openai-compat>.
- LM Studio REST API comparison documents custom tools for `/v1/chat/completions` and `/v1/responses`, and MCP support only for `/api/v1/chat` and `/v1/responses`: <https://lmstudio.ai/docs/developer/rest>.
- LM Studio tool-use docs describe caller-executed custom function tools through the `tools` request field, not hosted web search/fetch: <https://lmstudio.ai/docs/developer/openai-compat/tools>.
- OpenAI official docs describe web search as a hosted Responses API tool and limited Chat Completions search-model path: <https://platform.openai.com/docs/guides/tools-web-search>.

## Recommendation

Add provider-neutral capability detection in `agent-core`, keep provider-owned hosted web execution in Anthropic/Qwen, and make OpenAI-compatible LM Studio profiles fail early when configured for provider-native web search/fetch. Robota local `WebSearch`/`WebFetch` remain the explicit fallback users can select by using local tools; provider code must not silently route native web requests to them.

## What

Add a development track for web search and web fetch support when Robota CLI uses an OpenAI-compatible provider such as LM Studio.

## Why

The Anthropic provider currently exposes search and fetch behavior through provider-level API capabilities, so Robota can call the provider API path directly. LM Studio's OpenAI-compatible API path is expected to behave differently: it provides chat-completion compatibility, but it does not provide equivalent provider-native web search or fetch features.

Without a replacement design, switching the CLI to LM Studio can make prompts that depend on web search or URL fetching fail, silently degrade, or produce inconsistent behavior across providers.

## Current Assumption

| Provider path               | Search/fetch expectation                                                           |
| --------------------------- | ---------------------------------------------------------------------------------- |
| Anthropic provider          | Provider-level search/fetch capability is available                                |
| LM Studio OpenAI-compatible | Chat-completion API is available, but provider-native search/fetch is not expected |

This backlog item should be validated against the actual LM Studio OpenAI-compatible API behavior before implementation starts.

## Scope

- Identify every Robota CLI and SDK path that currently relies on provider-level search or fetch behavior.
- Define a provider-agnostic abstraction for search/fetch availability and execution.
- Decide whether OpenAI-compatible LM Studio should:
  - reject search/fetch requests with a clear capability error,
  - route search/fetch through Robota-owned tools,
  - or support both modes based on explicit configuration.
- Preserve Anthropic provider behavior while adding OpenAI-compatible handling.
- Add user-facing CLI behavior that makes unsupported search/fetch capability clear.

## Non-Goals

- Do not assume every OpenAI-compatible server supports the same search/fetch extensions.
- Do not add hidden fallback behavior that silently changes provider semantics.
- Do not require LM Studio model changes for basic chat completion.

## Acceptance Criteria

- [ ] Provider capability detection distinguishes native search/fetch support from chat-completion-only providers.
- [ ] LM Studio OpenAI-compatible configuration has explicit behavior for search/fetch requests.
- [ ] CLI output clearly explains when search/fetch is unavailable for the selected provider.
- [ ] Anthropic provider search/fetch behavior remains unchanged.
- [ ] Unit tests cover capability detection, unsupported capability errors, and any Robota-owned search/fetch routing.
- [ ] Integration or scenario tests cover at least one LM Studio OpenAI-compatible path without native search/fetch support.

## Risks & Mitigations

| Risk                                             | Mitigation                                                             |
| ------------------------------------------------ | ---------------------------------------------------------------------- |
| Provider-specific behavior leaks into CLI UI     | Keep provider capability checks behind provider or SDK-level contracts |
| Search/fetch requests fail late during streaming | Validate capabilities before request execution when possible           |
| Hidden fallback changes model behavior           | Require explicit configuration for Robota-owned search/fetch routing   |
| Anthropic behavior regresses                     | Add regression tests around existing provider-level search/fetch paths |

## Promotion Path

1. Assign backlog ID, for example `CLI-BL-027`.
2. Move this file to `.agents/tasks/<ID>-openai-compatible-web-search-fetch.md`.
3. Branch from `develop` for implementation.
4. Update relevant provider and CLI specs before code changes.
