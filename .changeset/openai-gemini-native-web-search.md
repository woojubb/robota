---
'@robota-sdk/agent-core': minor
'@robota-sdk/agent-provider-openai': minor
'@robota-sdk/agent-provider-gemini': minor
'@robota-sdk/agent-provider-anthropic': minor
'@robota-sdk/agent-cli': minor
---

Add model-native web search to the OpenAI provider (hosted `web_search` on OpenAI's own Responses API) and the Gemini provider (Google Search grounding), enabled with the profile option `nativeWebTools.webSearch`. The CLI's default applies to them and leaves OpenAI-compatible endpoints alone.

Breaking: `IProviderDefinition.nativeWebTools` is now a function of the profile being built and the environment the host passes, since the answer can depend on where a profile connects. The OpenAI definition no longer reads `builtInWebTools`, and it reads `nativeWebTools` strictly. New in `agent-core`: `readNativeWebSearchOption`, and `PROVIDER_CONTINUATION_METADATA_KEY`, opaque text a provider needs back on a later request, which the committed assistant message keeps. Gemini uses it to return signed function calls and server-side tool steps.
