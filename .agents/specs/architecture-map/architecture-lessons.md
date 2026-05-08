# Architecture Lessons and Audit

Resolved architecture audit findings, durable lessons, and the architecture-map update policy.

Back to [System Architecture Map](../ARCHITECTURE-MAP.md).

## Architecture Audit

### SYS-AUDIT-001: No Repository-Wide Architecture Router Existed

Status: resolved by this document.

Problem:

`packages/agent-cli/docs/ARCHITECTURE-MAP.md` was the only scan-friendly map, but repository work
also spans SDK, runtime, command modules, MCP, apps, and docs deployment. The repository needed one
architecture-map entrypoint and document tree instead of treating the CLI map as the implicit
architecture root.

Resolution:

The repository architecture router and `architecture-map/` subdocuments own repository-wide
architecture. The CLI package map remains a stable entrypoint for terminal product composition.

### SYS-AUDIT-005: Docs Deploy Still Referenced GitHub Pages

Status: resolved by `INFRA-BL-006`.

The source tree now points docs production deployment to Cloudflare Pages. `docs:deploy` is a manual
Wrangler direct upload helper, and release workflow docs handling is build verification only.

## Governance and Update Policy

Update this document in the same PR whenever a change affects any of these:

- cross-package dependency direction among agent, app, or docs packages;
- a new product shell, transport, CLI, MCP server, HTTP client, or deployment boundary;
- movement of an owner contract between packages;
- an architecture decision that cannot be described accurately inside one package `SPEC.md`;
- package-local architecture maps that need a master-map parent pointer.

Before merging a system architecture change:

- Check package manifests for new dependency edges.
- Check source imports with `rg -n "from '@robota-sdk|from \"@robota-sdk" packages apps`.
- Check package `docs/SPEC.md` files for owner drift.
- Run `pnpm harness:scan:deps`, `pnpm harness:scan:specs`, and any affected package checks.
- Add follow-up backlog for any confirmed contradiction that is too large for the current PR.
