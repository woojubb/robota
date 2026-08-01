---
title: 'REL-015: Add npm keywords to agent-cli and agent-framework packages'
status: done
done_at: 2026-05-25
created: 2026-05-25
priority: medium
urgency: before-announcement
area: packages/agent-cli/package.json, packages/agent-framework/package.json
depends_on: []
---

## Background

`@robota-sdk/agent-cli` has **zero npm keywords**.
`@robota-sdk/agent-framework` has **zero npm keywords**.
`@robota-sdk/agent-core` has 27 keywords.

The two packages that developers actually install — the CLI and the framework — are
invisible to npm search. A developer searching npm for "ai coding assistant typescript"
or "agent sdk typescript" will not find these packages.

Source: pre-release PM audit P2.9 (2026-05-25).

## Change Required

**`packages/agent-cli/package.json`** — add keywords:

```json
"keywords": [
  "ai", "cli", "coding-assistant", "agent", "llm", "anthropic", "openai",
  "claude", "typescript", "developer-tools", "terminal", "automation"
]
```

**`packages/agent-framework/package.json`** — add keywords:

```json
"keywords": [
  "ai", "agent", "sdk", "llm", "anthropic", "openai", "gemini", "typescript",
  "agent-framework", "ai-agent", "tool-use", "multi-provider", "embedded-agent"
]
```

Also check `@robota-sdk/agent-provider/package.json` for keyword coverage.

## Acceptance Criteria

- `@robota-sdk/agent-cli` has at least 8 relevant npm keywords
- `@robota-sdk/agent-framework` has at least 8 relevant npm keywords
