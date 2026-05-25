---
title: 'REL-011: Fix stale paths in .github/CODEOWNERS'
status: done
done_at: 2026-05-25
created: 2026-05-25
priority: high
urgency: soon
area: .github/CODEOWNERS
depends_on: []
---

## Background

`.github/CODEOWNERS` references paths that do not exist:

- `packages/agents/` (does not exist)
- `packages/core/` (does not exist — correct is `packages/agent-core/`)
- `apps/web/` (does not exist — correct is `apps/www/`)

PRs to the actual packages (`packages/agent-core/`, `packages/agent-framework/`, etc.)
get no automatic reviewer assignment because no CODEOWNERS pattern matches them.
For an open-source project inviting contributions, this is an operational gap.

Source: pre-release PM audit P2.10 (2026-05-25).

## Change Required

Update `.github/CODEOWNERS` with correct paths matching the current monorepo layout:

```
# Core SDK packages
packages/agent-core/        @woojubb
packages/agent-framework/   @woojubb
packages/agent-session/     @woojubb
packages/agent-provider/    @woojubb
packages/agent-tools/       @woojubb
packages/agent-cli/         @woojubb

# Apps
apps/docs/     @woojubb
apps/www/      @woojubb
apps/agent-web/ @woojubb
```

Adjust owner assignments as appropriate.

## Acceptance Criteria

- No paths in `.github/CODEOWNERS` that return "path not found" in the repo
- Core package directories all have owner assignments
