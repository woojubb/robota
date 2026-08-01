# CLI-BL-038 Qwen API Provider

- **Status**: completed
- **Created**: 2026-05-01
- **Branch**: feat/qwen-api-provider
- **Scope**: packages/agent-provider-qwen, packages/agent-cli, docs, .agents/tasks

## Objective

Add first-class Robota provider support for Qwen through Alibaba Cloud Model Studio / DashScope while preserving Robota's composable provider-definition architecture. Generic SDK and CLI layers must consume an injected provider definition and must not infer Qwen behavior from model names or provider-specific branches.

## Prior Art Research

- Alibaba Cloud Model Studio documents three Qwen API surfaces: OpenAI Chat Completions, OpenAI Responses, and native DashScope. The Qwen API reference describes OpenAI Chat as the mature migration path, Responses as the path with built-in tools, and DashScope as the most complete native feature surface.
- OpenAI Chat Completions endpoints are region-specific:
  - Singapore: `https://dashscope-intl.aliyuncs.com/compatible-mode/v1`
  - US Virginia: `https://dashscope-us.aliyuncs.com/compatible-mode/v1`
  - Beijing: `https://dashscope.aliyuncs.com/compatible-mode/v1`
  - Hong Kong: `https://cn-hongkong.dashscope.aliyuncs.com/compatible-mode/v1`
- Authentication uses a Model Studio API key, typically provided as `DASHSCOPE_API_KEY`. API keys are region-specific and must match the selected base URL.
- OpenAI Chat supports standard chat messages, streaming with `stream: true`, tool calling, structured output, multimodal inputs for VL models, and Qwen-specific `extra_body` options such as `enable_thinking`.
- Official error guidance highlights invalid API keys, region mismatch, unsupported OpenAI-compatible mode, model-not-found, permission/quota errors, and timeouts. It recommends streaming for long language-model calls and notes a 300s timeout for some language-model requests.

Sources:

- <https://www.alibabacloud.com/help/en/model-studio/qwen-api-reference/>
- <https://www.alibabacloud.com/help/en/model-studio/qwen-api-via-openai-chat-completions>
- <https://www.alibabacloud.com/help/en/model-studio/qwen-api-via-openai-responses>
- <https://www.alibabacloud.com/help/en/model-studio/qwen-api-via-dashscope>
- <https://www.alibabacloud.com/help/en/model-studio/error-code>
- <https://qwenlm.github.io/Qwen-Agent/en/guide/get_started/configuration/>

## Decision

The first Robota Qwen provider will be a dedicated `@robota-sdk/agent-provider-qwen` package that composes `agent-provider-openai-compatible` Chat Completions primitives. It will own Qwen/DashScope defaults, region-aware base URLs, API-key setup labels, provider-owned request metadata, and Qwen error wrapping. Native DashScope and OpenAI Responses built-in tools remain future work because they would require a different transport contract.

## Plan

- [x] Promote backlog item to active task.
- [x] Complete official Qwen API research.
- [x] Create package SPEC for `agent-provider-qwen`.
- [x] Add failing provider-definition and provider behavior tests.
- [x] Implement Qwen provider shell using OpenAI-compatible primitives.
- [x] Inject Qwen provider definition into CLI default provider definitions.
- [x] Update package/project docs and examples.
- [x] Run targeted build, tests, typecheck, lint, and harness verification.

## Acceptance Criteria

- [x] Qwen provider boundary and package ownership are documented before implementation.
- [x] Provider setup is injected through the common provider definition/composition contract.
- [x] Streaming and tool calling are covered by unit tests using provider-owned fixtures.
- [x] Native DashScope and OpenAI Responses are documented as out of scope for this Chat Completions provider.
- [x] CLI settings can select the Qwen provider without adding provider-name branches to generic execution code.
- [x] SDK examples show Qwen provider composition without making SDK core depend on Qwen.

## Test Plan

- Provider-definition tests:
  - Given no explicit values, `createQwenProviderDefinition()` exposes Qwen defaults and setup steps.
  - Given a profile, it creates `QwenProvider` with resolved API key, model, base URL, and timeout.
  - Given no API key, provider creation fails with a Qwen-owned error.
- Provider tests:
  - Given chat messages and tools, non-streaming chat sends OpenAI-compatible messages/tools and parses tool calls.
  - Given `onTextDelta`, chat uses streaming assembly and emits visible deltas.
  - Given `chatStream`, streamed chunks yield universal assistant messages.
  - Given an upstream error code/message, provider wraps it as `Qwen chat failed: ...` or `Qwen stream failed: ...`.
- CLI tests:
  - Given injected default definitions, provider setup/factory can select `qwen` without CLI provider-specific branches.
- Verification commands:
  - `pnpm --filter @robota-sdk/agent-provider-qwen test`
  - `pnpm --filter @robota-sdk/agent-provider-qwen typecheck`
  - `pnpm --filter @robota-sdk/agent-provider-qwen build`
  - `pnpm --filter @robota-sdk/agent-cli test`
  - `pnpm harness:verify -- --base-ref origin/develop --skip-record-check`

## Progress

### 2026-05-01

- Created branch `feat/qwen-api-provider` from updated `develop`.
- Promoted Qwen provider backlog item to active task.
- Researched current official Alibaba Cloud Model Studio / Qwen documentation.
- Added `agent-provider-qwen` package spec and RED tests for provider definition, chat, streaming, and error wrapping.
- Implemented `QwenProvider` using shared OpenAI-compatible primitives.
- Injected Qwen into CLI default provider definitions without adding provider-specific factory branches.
- Updated CLI/SDK docs, architecture docs, project structure, and publish registry for the new provider.
- Verified Qwen provider tests/typecheck/lint/build, CLI provider factory tests/typecheck/build, full `harness:scan`, and changed-scope `harness:verify`.

## Blockers

None.

## Result

Implemented `@robota-sdk/agent-provider-qwen` as a dedicated provider package over Alibaba Cloud Model Studio / DashScope OpenAI-compatible Chat Completions. The CLI now injects Qwen through the same provider-definition composition path as other providers, and documentation covers Qwen settings, defaults, package ownership, and publishing status.
