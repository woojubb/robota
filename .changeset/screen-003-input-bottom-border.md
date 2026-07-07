---
'@robota-sdk/agent-transport-tui': patch
---

Stabilize the TUI input box bottom border during active output: hand-draw it as a `<Text>` row (mirroring the top border) instead of a Yoga-synthesized Box border, which could drop glyphs under rapid re-render at full terminal height (SCREEN-003).
