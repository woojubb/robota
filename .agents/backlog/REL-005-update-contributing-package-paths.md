---
title: 'REL-005: Update CONTRIBUTING.md — stale package paths'
status: done
done_at: 2026-05-25
created: 2026-05-25
priority: critical
urgency: immediate
area: CONTRIBUTING.md
depends_on: []
---

## Background

`CONTRIBUTING.md` project structure section lists:

- `packages/core` (does not exist — correct is `packages/agent-core`)
- `packages/openai` (does not exist — correct is part of `packages/agent-provider`)
- `packages/anthropic` (does not exist — correct is part of `packages/agent-provider`)
- `packages/tools` (does not exist — correct is `packages/agent-tools`)

Any developer who reads CONTRIBUTING.md before contributing will see a project structure
that looks nothing like the actual repository. This is the highest-visibility trust signal
for "is this project actively maintained?" Source: pre-release PM audit P0.2 (2026-05-25).

## Change Required

Update the project structure section in `CONTRIBUTING.md` to reflect the actual monorepo layout:

```
packages/
  agent-core/          — runtime engine, no deps on other agent-* packages
  agent-session/       — permission, history, context window
  agent-tools/         — built-in tools (Bash, Read, Write, etc.)
  agent-provider/      — AI providers (Anthropic, OpenAI, Gemini, DeepSeek, …)
  agent-framework/     — assembly layer: createQuery, InteractiveSession, createAgentRuntime
  agent-command/       — slash command system
  agent-cli/           — CLI binary (@robota-sdk/agent-cli)
  agent-executor/      — execution engine (internal)
  agent-plugin/        — plugin infrastructure
  ...
apps/
  agent-web/           — web playground
  docs/                — VitePress documentation site
  www/                 — marketing site
  starter-nextjs/      — Next.js starter template
```

Also update any setup/build commands if they reference non-existent paths.

## Acceptance Criteria

- No reference to `packages/core`, `packages/openai`, `packages/anthropic`, `packages/tools`
  in `CONTRIBUTING.md`
- Actual package names match `pnpm-workspace.yaml`
