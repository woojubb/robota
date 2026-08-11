---
title: 'REL-014: Record demo GIF for agent-cli README'
status: todo
created: 2026-05-25
priority: medium
urgency: before-announcement
area: packages/agent-cli/docs/
depends_on: []
---

## Background

`packages/agent-cli/README.md` includes:

```markdown
![Demo](./docs/demo.gif)
```

`packages/agent-cli/docs/demo.gif` is a **1×1 pixel placeholder** (41 bytes).
Any developer who views the README on GitHub before installing sees a broken/blank image
where a compelling terminal demo should be.

For a CLI product, a terminal demo recording is the single highest-value marketing asset.
Its absence is conspicuous compared to the quality of the rest of the documentation.

Source: pre-release PM audit P2.8 (2026-05-25).

## Change Required

Record a terminal session demo (~30–60 seconds) showing:

1. `npx @robota-sdk/agent-cli` first-run setup (provider selection, API key prompt)
2. A representative agentic task (e.g., "write a function that sorts an array" or
   "explain this code")
3. Multi-turn follow-up

Recommended tools: `vhs` (charmbracelet), `asciinema` + `svg-term`, or `terminalizer`.

Output: `packages/agent-cli/docs/demo.gif` (replace the placeholder).
Also consider a `.mp4` or `.webm` version for the docs site.

## Acceptance Criteria

- `packages/agent-cli/docs/demo.gif` is an actual animated recording (> 10KB)
- The GitHub README displays a working animated demo
