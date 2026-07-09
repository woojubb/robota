---
title: 'REL-002: Fix invalid npm install command in Getting Started docs'
status: done
done_at: 2026-05-25
created: 2026-05-25
priority: critical
urgency: immediate
area: content/getting-started/README.md
depends_on: []
---

## Background

`content/getting-started/README.md` at lines 58 and 64 instructs developers to run:

```bash
npm install @robota-sdk/agent-core @robota-sdk/agent-provider-anthropic @anthropic-ai/sdk
```

`@robota-sdk/agent-provider-anthropic` is a **TypeScript sub-path export**, not a separate npm package.
Running this command fails with an npm error. This is the first code block a new SDK developer copies.

Same error appears in `content/README.md` if it has a code sample.

Source: pre-release dev audit G2 + PM audit P0.1 (2026-05-25).

## Change Required

Replace the incorrect install command:

```bash
# Wrong
npm install @robota-sdk/agent-core @robota-sdk/agent-provider-anthropic @anthropic-ai/sdk

# Correct
npm install @robota-sdk/agent-core @robota-sdk/agent-provider
```

Note: `@anthropic-ai/sdk` is a direct dependency of `@robota-sdk/agent-provider` and installs
transitively — developers do not need to install it separately unless they import Anthropic SDK
types directly.

Search the entire `content/` directory for this pattern and fix all occurrences.

## Acceptance Criteria

- `grep -rn "agent-provider/anthropic" content/` returns zero install command lines
- The install instructions in `content/getting-started/README.md` are verified correct
