---
'@robota-sdk/agent-framework': major
'@robota-sdk/agent-interface-session-mobility': minor
'@robota-sdk/agent-cli': patch
---

Move handoff source/destination orchestration and its contract from agent-framework to the session-mobility owner. Import `HandoffSource`, `HandoffDestination`, and their option types from `@robota-sdk/agent-interface-session-mobility`. Mobility now applies offer and authority decisions directly, while the CLI supplies wire effects and the session-record decoder. A successful offer no longer returns a mutable authority transaction.
