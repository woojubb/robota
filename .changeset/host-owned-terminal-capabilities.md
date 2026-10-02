---
'@robota-sdk/agent-ui-terminal': major
'@robota-sdk/agent-cli': patch
---

The terminal renderer no longer reads `PRODUCT_IME_CURSOR` or `PRODUCT_TURN_MARKS` from the process environment. SDK hosts calling `renderApp` directly should pass cursor and turn-mark choices through the optional `terminalCapabilities` render option. Without a host choice, the renderer keeps its terminal and TTY defaults. The configured CLI still reads both environment variables and preserves its exact `1` and `0` overrides.
