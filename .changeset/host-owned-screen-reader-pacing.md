---
'@robota-sdk/agent-ui-terminal': major
'@robota-sdk/agent-cli': patch
---

The terminal renderer no longer reads `ROBOTA_SCREEN_READER_STARTUP_QUIET_MS` or
`ROBOTA_SCREEN_READER_PREPARK_MS` from the process environment. SDK hosts calling `renderApp`
directly should pass raw timing choices and diagnostic labels through the new optional
`screenReaderPacing` render option. Without it, the renderer uses its existing 900 ms startup
quiet period and 50 ms pre-write park when screen-reader mode is enabled. The Robota CLI still
reads the same environment variables and preserves their validation, bounds, and warnings.
