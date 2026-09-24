---
'@robota-sdk/agent-executor': major
'@robota-sdk/agent-framework': minor
'@robota-sdk/agent-product': minor
'@robota-sdk/agent-ui-terminal': minor
'@robota-sdk/agent-cli': patch
---

The default background observer warning code and exported `OBSERVER_FAILURE_WARNING_CODE` value
change from `ROBOTA_BACKGROUND_OBSERVER_FAILURE` to `BACKGROUND_OBSERVER_FAILURE`. Hosts matching
the old warning code should match the new neutral code or provide `observerFailureWarningCode` in
their background manager or session options. The Robota CLI supplies its existing code explicitly
across print, goal, serve, MCP, and TUI sessions.
