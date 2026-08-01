---
title: 'REL-007: Audit publish registry — fix stale entries, set private packages correctly'
status: done
done_at: 2026-05-25
created: 2026-05-25
priority: critical
urgency: before-next-release
area: .agents/publish-registry.md, package.json files, .github/workflows/release.yml
depends_on: []
---

## Background

`.agents/publish-registry.md` was written for the old split-provider architecture.
It references packages that no longer exist:

- `agent-provider-anthropic`, `agent-provider-openai`, `agent-provider-gemini`, etc.
- `agent-runtime`, `agent-sessions`, `agent-sdk`

The current consolidated packages are not accurately described.

More critically: The registry indicates 16 packages should be `private: true`, but
their `package.json` files have `"private": null` (treated as publishable by pnpm).

The release workflow at `.github/workflows/release.yml` runs `pnpm -r publish --access public --no-git-checks`.
This would publish ALL packages with `"private": null` — including internal implementation packages
like `agent-web-ui`, `agent-interface-tui`, `agent-interface-transport`, `plugin-github`, `plugin-slack`, etc.

Source: pre-release dev audit §2b (2026-05-25).

## Change Required

1. **Audit decision**: Determine which packages are intentionally public and which should be private.
   Packages confirmed private: `agent-playground`, `agent-remote-client`, `agent-tool-mcp`.
   Packages that need review: `agent-web-ui`, `agent-interface-tui`, `agent-interface-transport`,
   `agent-executor`, `agent-plugin`, `agent-subagent-runner`, `agent-transport`,
   `plugin-github`, `plugin-jira`, `plugin-linear`, `plugin-notion`, `plugin-slack`.

2. For each package that should be private: set `"private": true` in its `package.json`.

3. **Update `.agents/publish-registry.md`** to reflect the actual current package landscape.

4. Verify the release workflow only publishes intended packages.

## Acceptance Criteria

- All packages that should be private have `"private": true` in `package.json`
- `.agents/publish-registry.md` accurately lists all packages with correct `private` status
- `pnpm -r publish` dry-run only targets the intended public packages
