---
'@robota-sdk/product-config': patch
'@robota-sdk/agent-cli': patch
---

Generated products can select a CLI package binary, version and build label, native host entry and artifact name, and desktop identity. Artifact metadata records the source version and provenance. Clean-tree generation copies only the committed source tree, while the built-in desktop remains packageable without generation.
