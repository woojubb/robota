---
"@robota-sdk/agent-cli": patch
"@robota-sdk/agent-app": patch
---

Build on the merged SDK packages. The CLI and the desktop app now import providers, host primitives, transport carriers, the default tool set, product assembly and the shared contracts from the subpaths of `@robota-sdk/agent-provider`, `@robota-sdk/agent-os`, `@robota-sdk/agent-transport`, `@robota-sdk/agent-tools`, `@robota-sdk/agent-product` and `@robota-sdk/agent-interface`, instead of the 27 separate packages those replace. The command line, the settings and the behavior are unchanged.
