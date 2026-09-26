---
'@robota-sdk/agent-builtin-providers': patch
'@robota-sdk/agent-capability-pack': patch
'@robota-sdk/agent-cli': patch
'@robota-sdk/agent-command': patch
'@robota-sdk/agent-core': patch
'@robota-sdk/agent-executor': patch
'@robota-sdk/agent-file-authority': patch
'@robota-sdk/agent-framework': patch
'@robota-sdk/agent-interface-analytics': patch
'@robota-sdk/agent-interface-command': patch
'@robota-sdk/agent-interface-execution': patch
'@robota-sdk/agent-interface-session': patch
'@robota-sdk/agent-interface-session-mobility': patch
'@robota-sdk/agent-interface-transport': patch
'@robota-sdk/agent-interface-tui': patch
'@robota-sdk/agent-mcp': patch
'@robota-sdk/agent-plugin': patch
'@robota-sdk/agent-preset': patch
'@robota-sdk/agent-process': patch
'@robota-sdk/agent-product': patch
'@robota-sdk/agent-provider-anthropic': patch
'@robota-sdk/agent-provider-bytedance': patch
'@robota-sdk/agent-provider-gemini': patch
'@robota-sdk/agent-provider-openai': patch
'@robota-sdk/agent-provider-openai-compatible': patch
'@robota-sdk/agent-remote-pairing': patch
'@robota-sdk/agent-session': patch
'@robota-sdk/agent-session-analytics': patch
'@robota-sdk/agent-subagent-runner': patch
'@robota-sdk/agent-tool-defaults': patch
'@robota-sdk/agent-tools': patch
'@robota-sdk/agent-transport': patch
'@robota-sdk/agent-transport-http': patch
'@robota-sdk/agent-transport-mcp': patch
'@robota-sdk/agent-transport-webrtc': patch
'@robota-sdk/agent-transport-ws': patch
'@robota-sdk/agent-ui-terminal': patch
'@robota-sdk/pack-coding': patch
---

Every published package now declares `"engines": { "node": ">=22.0.0" }`, the floor
`@robota-sdk/agent-process`, `agent-cli`, `agent-ui-terminal`, `agent-remote-pairing` and the
`agent-transport*` packages already declared.
Before, 27 of the 38 packages declared no floor (`agent-core`, `agent-tools` and every provider among
them) and `agent-session` and `agent-file-authority` declared `>=20.19.0`, so a consumer on Node 20
saw at most a warning from a transitive dependency. `agent-session` and `agent-file-authority` move from
`>=20.19.0` to `>=22.0.0`.

The whole set is released in lockstep and tested only on Node 22 (`.nvmrc`); `agent-cli` and
`agent-ui-terminal` need Node 22 through `ink` 7 (`engines.node >=22`). `engines` is advisory unless
the consumer enables `engine-strict`.

No code changes: `tsdown` now reads `node22.0.0` as its build target from the new field, and every
package's built `dist` is byte-identical to before.
