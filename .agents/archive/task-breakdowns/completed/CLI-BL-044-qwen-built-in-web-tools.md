# CLI-BL-044 Qwen Built-in Web Tools

- **Status**: completed
- **Created**: 2026-05-02
- **Branch**: feat/qwen-built-in-web-tools
- **Scope**: packages/agent-provider-qwen, packages/agent-provider-openai-compatible, packages/agent-core, packages/agent-cli
- **Related**: .agents/tasks/completed/CLI-BL-038-qwen-api-provider.md

## Objective

Add a narrowly scoped Qwen built-in web tools capability for Robota, focused first on WebSearch/WebFetch-equivalent behavior through Alibaba Cloud Model Studio Qwen APIs, without attempting to support every Qwen built-in tool.

## Problem

`CLI-BL-038` implemented Qwen through OpenAI-compatible Chat Completions. That path supports normal chat, streaming, and user-defined function/tool calling, but Alibaba Cloud documents richer Qwen built-in tools through OpenAI-compatible Responses API and DashScope-specific parameters.

Robota should not mix provider/server-side built-in tools with local Robota tools as if they had the same execution semantics. Qwen built-in tools are executed by the provider service, have provider-specific billing/provenance behavior, and return provider-specific response items. Robota needs a provider-owned capability layer before exposing them as user-facing WebSearch/WebFetch equivalents.

## Research Findings

Official Alibaba Cloud Model Studio documentation separates Qwen API surfaces:

- OpenAI Chat Completions: mature migration path for chat, streaming, and user-defined function calling.
- OpenAI Responses: supports built-in web search, code interpreter, web extractor, file search, image search, and MCP-style tools depending on model/region.
- DashScope: native API surface with the broadest Qwen feature coverage.

Relevant sources:

- Qwen API interfaces: <https://www.alibabacloud.com/help/en/model-studio/qwen-api-reference/>
- Qwen Responses API built-in tools: <https://www.alibabacloud.com/help/en/model-studio/qwen-api-via-openai-responses>
- Web search: <https://www.alibabacloud.com/help/en/model-studio/web-search>
- Web extractor: <https://www.alibabacloud.com/help/en/model-studio/web-extractor>
- Code interpreter: <https://www.alibabacloud.com/help/en/model-studio/qwen-code-interpreter>
- qwen3.6-plus Token Plan built-in tools overview: <https://www.alibabacloud.com/help/en/model-studio/token-plan-tool>

## Terminology

- `web_search`: Provider-side web search. This is closest to Robota's `WebSearch` intent: retrieve up-to-date web information and let the model answer from search results.
- `web_extractor`: Provider-side web page extraction. This is closest to Robota's `WebFetch` intent: fetch a specific URL or page content and provide extracted content to the model. Alibaba documentation notes that Responses API usage adds both `web_search` and `web_extractor` to `tools`.
- `code_interpreter`: Provider-side sandboxed Python execution for math, data analysis, or code-aided reasoning. This is not equivalent to Robota local shell/process tools and must not be treated as local command execution.

## Recommended Direction

Implement only provider-side web tools first:

- Add a Qwen-owned Responses API transport capability instead of overloading the existing Chat Completions provider path.
- Expose a Qwen provider option or provider definition capability for enabling built-in web tools.
- Map Robota WebSearch/WebFetch intent to Qwen `web_search` and `web_extractor` only inside `agent-provider-qwen`.
- Preserve local Robota tools as separate tools with separate permissions, logs, and execution ownership.
- Persist provider-side tool usage metadata in session logs so users can audit when Qwen used built-in web tools.

Do not implement `code_interpreter` in the first slice. It executes provider-hosted Python in a sandbox and needs separate safety, billing, output-shape, and provenance design.

## Scope

- Qwen Responses API request/stream parsing required for `web_search` and `web_extractor`.
- Provider-owned capability metadata that says Qwen can provide web-search/web-fetch behavior.
- Session-log provenance for provider-side built-in tool invocations and final response text.
- CLI configuration documentation for enabling Qwen built-in web tools.
- Tests using provider-owned fixtures for Responses API events and completed responses.

## Non-Goals

- No first-slice support for `code_interpreter`.
- No first-slice support for `file_search`, `web_search_image`, `image_search`, or MCP tools.
- No native DashScope transport implementation unless Responses API cannot satisfy WebSearch/WebFetch.
- No generic CLI/SDK branches for Qwen model names or provider type names.
- No replacement of Robota local tools with provider-side built-in tools.
- No hidden provider-side network access without configuration and session-log evidence.

## Plan

- [x] Update `agent-provider-qwen` SPEC with built-in web tools ownership and Responses API boundary.
- [x] Define a provider-side built-in tool capability contract that generic layers can observe without provider-name branching.
- [x] Add Qwen Responses API request and response/event parsing for `web_search` and `web_extractor`.
- [x] Add provider fixtures for non-streaming and streaming Responses API output with provider-side web tool events.
- [x] Add session-log metadata for provider-side built-in tool usage.
- [x] Add CLI docs/settings guidance for enabling Qwen built-in web tools.
- [x] Keep `code_interpreter` documented as a future separate backlog item.
- [x] Run targeted Qwen provider tests, typecheck, build, lint, and harness scan.

## Progress

### 2026-05-02

- Added provider-owned Qwen Responses API support for `web_search` and `web_extractor`.
- Added a generic provider `options` bag through provider definitions, CLI settings, SDK config loading, and runtime serialization so provider-owned capabilities can be injected without CLI/SDK provider-name branches.
- Added Qwen provider tests for Responses API request construction, streaming output assembly, provider-side tool provenance, and local function-tool separation.
- Updated package specs and README guidance for enabling Qwen built-in web tools and deferring provider-hosted code interpreter support.

## Test Plan

- Given Qwen built-in web tools are disabled, when a normal Qwen chat request runs, then it uses the existing Chat Completions path and sends no Responses API built-in tools.
- Given built-in web search is enabled, when the provider sends a Responses API request, then the request includes `web_search`.
- Given built-in web fetch/extraction is enabled, when the provider sends a Responses API request, then the request includes `web_search` and `web_extractor` as required by Qwen documentation.
- Given a streamed Responses API event contains `response.output_text.delta`, when parsed, then Robota emits normal visible text deltas.
- Given a streamed Responses API event reports a `web_extractor_call` or web-search tool completion, when parsed, then Robota records provider-side tool provenance without exposing it as a local Robota tool execution.
- Given provider-side tool usage exists, when session logs are inspected, then the logs show which Qwen built-in tools were enabled and used.
- Given a user-defined Robota `WebSearch` or `WebFetch` tool is also available, when the model calls a local tool, then Robota local permission/logging semantics remain unchanged.
- Given `code_interpreter` appears in provider output fixtures, when first-slice parsing runs, then Robota treats it as unsupported provider-side metadata and does not execute or emulate it locally.

## Acceptance Criteria

- Qwen WebSearch/WebFetch-equivalent support is provider-owned and does not add Qwen-specific branches to generic CLI/SDK layers.
- First implementation scope is limited to `web_search` and `web_extractor`.
- Provider-side built-in tool usage is auditable in session logs.
- Local Robota tools and provider-side built-in tools remain distinct in permissions, lifecycle, and provenance.
- `code_interpreter` and other built-in tools are explicitly deferred with documented reasons.

## Blockers

None.

## Result

Implemented Qwen provider-side WebSearch/WebFetch-equivalent support through the Alibaba Cloud Model Studio OpenAI-compatible Responses API. Generic layers preserve provider-owned options without knowing Qwen-specific settings, and Qwen provider metadata records enabled/used built-in tools separately from local Robota tool calls.
