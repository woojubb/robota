---
name: pnpm-monorepo-build
description: Provide pnpm monorepo build commands and workflow guidance. Use when running package builds, filtered builds, or discussing build order.
---

# pnpm Monorepo Build

## Rule Anchor
- `AGENTS.md` > "Project Structure"
- `AGENTS.md` > "Build Requirements"

## Scope
Use this skill to choose the correct pnpm build commands for the workspace.

## Common Commands
```bash
pnpm --filter @robota-sdk/* build
pnpm --filter @robota-sdk/agents build
pnpm --filter @robota-sdk/openai build
pnpm --filter @robota-sdk/team build
pnpm build
```

## Build Order Notes
- Build core packages first (agents), then dependents.
- Use `--filter` to limit scope when possible.

## Verification
- Check exit codes and logs for build success.
