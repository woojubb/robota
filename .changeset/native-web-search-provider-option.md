---
'@robota-sdk/agent-core': patch
'@robota-sdk/agent-session': patch
'@robota-sdk/agent-provider-anthropic': patch
'@robota-sdk/agent-provider-openai': patch
'@robota-sdk/agent-framework': patch
'@robota-sdk/agent-cli': patch
---

Make model-native web search a provider construction option. Sessions no longer switch it on (`IAIProvider.configureNativeWebTools` is removed); an Anthropic profile enables it with `options.nativeWebTools.webSearch`, and a provider definition declares the hosted web tools it supports in `nativeWebTools`. The CLI turns native web search on by default for every definition that declares it, unless the profile sets `nativeWebTools` itself.
