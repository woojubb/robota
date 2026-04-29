# OpenAI-Compatible Web Search and Fetch Support

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
