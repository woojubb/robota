---
'@robota-sdk/agent-tools': patch
'@robota-sdk/agent-tool-defaults': patch
'@robota-sdk/agent-framework': patch
'@robota-sdk/pack-coding': patch
'@robota-sdk/agent-transport-acp': patch
---

Remove the built-in `WebSearch` tool, its `IWebSearchProvider` port and the Brave adapter (`webSearchTool`, `createWebSearchTool`, `createBraveSearchProvider`). Web search now comes from model-native provider search and from MCP servers. `createDefaultTools` holds only tools that need no external service or adapter: its `retrievalAdapter` and `computerDriver` options are gone, as is the framework's `retrievalAdapter` session option; a composition root that has such an adapter builds `createRetrievalTool` / `createComputerTool` itself.
