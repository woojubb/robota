---
'@robota-sdk/agent-product': minor
'@robota-sdk/agent-ui-terminal': patch
---

The product-assembly packages are now one package, `@robota-sdk/agent-product`. Its root export is unchanged; the rest are subpaths: `capability-pack` (was `@robota-sdk/agent-capability-pack`), `preset` and `preset/node` (was `@robota-sdk/agent-preset` and its `./node`), `command` and `command/node` (was `@robota-sdk/agent-command` and its `./node`) and `coding` (was `@robota-sdk/pack-coding`). Import the subpath you use (`@robota-sdk/agent-product/preset`). The root, `capability-pack`, `preset` and `command` stay platform-neutral; `preset/node`, `command/node` and `coding` are Node only and map `browser: null`. The exported names and signatures are unchanged, and a consumer's install does not grow: every package the merged manifest names is already installed with `@robota-sdk/agent-framework`, which each of the old packages required. `@robota-sdk/agent-capability-pack`, `@robota-sdk/agent-preset`, `@robota-sdk/agent-command` and `@robota-sdk/pack-coding` no longer receive releases.
