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
pnpm --filter @robota-sdk/agent-core build
pnpm --filter @robota-sdk/agent-provider-openai build
pnpm --filter @robota-sdk/agent-team build
pnpm build
```

## Build Order Notes

- Build core packages first (agents), then dependents.
- Use `--filter` to limit scope when possible.

## Adding a Workspace Dependency

When adding (or removing) a `workspace:*` dependency between packages, edit the lockfile **surgically** —
never regenerate it with a full `pnpm install` in a network-restricted/sandbox environment.

1. Edit the consumer `package.json`: add the dep under `dependencies`/`devDependencies` as
   `"@robota-sdk/<pkg>": "workspace:*"`.
2. Apply a **surgical** `pnpm-lock.yaml` edit — add the entry to that package's `dependencies:` block:
   - `specifier: workspace:*`
   - `version: link:../<pkg>` for a sibling package, or `link:../../packages/<pkg>` for an app
     consuming a package.
3. Verify with `pnpm install --frozen-lockfile` — it must succeed without rewriting the lockfile.

**NEVER** commit a `pnpm-lock.yaml` that a full `pnpm install` regenerated in a network-restricted/sandbox
env: it prunes the lockfile by thousands of lines (offline resolution drops unreachable registry entries),
which is a corrupting change, not a real dependency update. If `--frozen-lockfile` fails, fix the surgical
edit — never resolve it by regenerating the whole lockfile.

## Verification

- Check exit codes and logs for build success.
- For dependency changes, confirm `pnpm install --frozen-lockfile` passes and the lockfile diff is limited
  to the intended `dependencies:` block.
