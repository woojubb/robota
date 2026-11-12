---
"@robota-sdk/agent-framework": patch
---

The error thrown for a missing `host`, or for `createNodeFrameworkHost` called without `createDefaultTools`, now names `@robota-sdk/agent-tools/defaults`, where `createDefaultTools` lives, instead of the retired `@robota-sdk/agent-tool-defaults` package.
