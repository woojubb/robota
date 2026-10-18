---
'@robota-sdk/agent-transport-mcp': minor
'@robota-sdk/agent-interface-session': patch
'@robota-sdk/agent-framework': patch
'@robota-sdk/agent-cli': patch
---

**`robota mcp serve --ask-client` puts a caller's permission and ask prompts to the calling MCP client through elicitation instead of failing them.**

`@robota-sdk/agent-transport-mcp`: `createMcpTransport`, `createMcpHttpHost`,
`createMcpRemoteHttpHost` and `createAgentMcpServer` take `askClient`. Off by default, every prompt
is a tool error as before. On, and when the client declared form-mode elicitation, a permission or
ask prompt raised by that client's own call is put to it: a permission offers allow once or deny
only, never a remembered grant; an ask becomes a form (choice, multiple choice, free text); a masked
ask is never sent; deny, decline, cancel, a client error or an answer naming nothing offered keeps
today's outcome. stdio asks during the call. The HTTP hosts keep no session state, so they ask only
a client on the 2026-07-28 revision, through input-required rounds whose `requestState` is a
single-use random token naming one parked call; a 2025-era HTTP client keeps the tool error.
Breaking for hand-written sessions: `IMcpTransportSession` now also requires `ISessionEvents`
(`on`/`off`) and `ISessionPromptResolution` (`resolvePermission`/`resolveAsk`), which
`InteractiveSession` and the published test double already implement.

`@robota-sdk/agent-interface-session` / `@robota-sdk/agent-framework`:
`ISessionRuntimeTools.invokeRuntimeTool` accepts `options.driverId`, and `InteractiveSession` makes
that driver the active one while the direct call runs, so a prompt the call raises carries it as
`requesterDriverId`. With `askClient` on, an MCP call runs under its own `mcp:<n>` driver id; a
submission made that way is attributed to it rather than to the owner.

`@robota-sdk/agent-cli`: `mcp serve --ask-client` turns this on for whichever carrier the run serves.
