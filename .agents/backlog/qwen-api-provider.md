# Qwen API Provider

## What

Add first-class Robota provider support for Qwen API access.

## Why

Qwen models are a major provider/model family that users may want to access directly from Robota. A dedicated provider path should make Qwen configuration, streaming, tool calling, and model capability behavior explicit instead of forcing users through a loosely documented OpenAI-compatible configuration.

## Research Required

Before implementation, research current official Qwen API documentation and supported access paths. The research should confirm:

- supported API endpoints and authentication model;
- whether the recommended integration path is native Qwen/DashScope API, OpenAI-compatible API, or both;
- current chat, streaming, tool/function calling, reasoning, vision, and embedding capabilities;
- model naming, model capability metadata, and context-length behavior;
- error shapes, rate limits, and retry guidance;
- any regional or account requirements that affect CLI setup.

Do not rely on stale model lists or unofficial examples when defining the provider contract.

## Scope

- Decide whether Qwen should be a dedicated package or a thin provider definition composed from shared OpenAI-compatible transport.
- Add a provider-owned setup/configuration path with API key, base URL, model selection, and capability metadata.
- Support streaming and tool calling according to the verified API behavior.
- Add provider-specific error mapping without leaking provider details into generic CLI or SDK layers.
- Add docs and examples for CLI and SDK composition.

## Non-Goals

- Do not hardcode Qwen behavior into `agent-cli`, `agent-sdk`, or shared OpenAI-compatible transport.
- Do not infer Qwen behavior from model-name strings in generic layers.
- Do not silently fall back to another provider when Qwen capability is unsupported.

## Acceptance Criteria

- [ ] Qwen provider boundary and package ownership are documented before implementation.
- [ ] Provider setup is injected through the common provider definition/composition contract.
- [ ] Streaming and tool calling are covered by unit tests using provider-owned fixtures.
- [ ] Unsupported capabilities produce explicit capability errors.
- [ ] CLI settings can select the Qwen provider without adding provider-name branches to generic execution code.
- [ ] SDK examples show Qwen provider composition without making SDK core depend on Qwen.

## Risks & Mitigations

| Risk                                      | Mitigation                                                           |
| ----------------------------------------- | -------------------------------------------------------------------- |
| Qwen API has multiple compatible surfaces | Decide and document native vs OpenAI-compatible ownership explicitly |
| Capability assumptions become stale       | Use provider-owned capability metadata and tests from official docs  |
| Generic layers become provider-aware      | Keep provider-specific behavior inside provider package adapters     |

## Promotion Path

1. Move to `.agents/tasks/CLI-BL-0XX-qwen-api-provider.md`.
2. Run current API research from official sources.
3. Write/update provider package SPEC before implementation.
