# LLM Text Node

`@robota-sdk/dag-node-llm-text` (internal) exports `LlmTextNodeDefinition`, node type `llm-text`
(category `AI`). It sends the input text as a prompt to a language model and emits the reply. It
works with any provider in the `IProviderDefinition[]` registry passed to its constructor
(`new LlmTextNodeDefinition(providers)`); it has no built-in provider list.

- **Input** `text` (string, required, non-empty).
- **Output** `text` (string) — the model's reply.
- **Config** `provider` (string) or `providers` (array of `{ provider, model?, priority }`) — one of
  the two is required; `model` (string, optional); `temperature` (default `0.2`); `maxTokens`
  (optional); `baseCredits` (default `0`); `options` (record, passed to the provider config).
  `strategy` and `maxCostUsd` are accepted but the node does not use them.

Providers are tried in ascending `priority`. An unknown provider, a provider without a resolvable
credential, or a model outside the provider's allowed list is skipped; the first successful reply is
returned. If every provider is skipped, the node fails with one validation error listing the reasons.

The node reads no environment variables itself: each provider definition declares its credential
(for example `ANTHROPIC_API_KEY` or `OPENAI_API_KEY`) and `agent-core` resolves it. The default node
set builds this node with the registry from `@robota-sdk/agent-builtin-providers` unless the host
injects one. The cost estimate is `baseCredits` plus a per-token estimate from the prompt length.

Contract: [SPEC.md](SPEC.md).
