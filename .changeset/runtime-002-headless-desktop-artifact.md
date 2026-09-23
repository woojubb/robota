---
'@robota-sdk/agent-cli': patch
---

Build a separate verified headless Bun artifact for the Electron desktop app. The full CLI binary and npm entry remain available; the desktop resource now copies the smaller presentation-free artifact while preserving the `--serve` wire and launch contract.
