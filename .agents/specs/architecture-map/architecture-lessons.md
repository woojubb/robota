# Architecture Lessons and Audit

Resolved architecture audit findings, durable lessons, and the architecture-map update policy.

Back to [System Architecture Map](../ARCHITECTURE-MAP.md).

> **Evidence policy**: An item may not be marked "resolved" without a verification artifact — a
> commit hash, PR number, or grep-output confirming the fix is present in the codebase. Items
> marked resolved without evidence must be reverted to open and re-resolved with evidence.

## Architecture Audit

### SYS-AUDIT-001: No Repository-Wide Architecture Router Existed

Status: resolved by this document.

Evidence: PR #313 (`2d6a4f569`) — "docs(architecture): split architecture map tree". The
`architecture-map/` subtree and `ARCHITECTURE-MAP.md` entrypoint were introduced in that PR.

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

Evidence: commit `f9e388fd7` — "infra(docs): migrate docs deploy to cloudflare pages". Task file
archived at `.agents/tasks/completed/INFRA-BL-006-docs-cloudflare-migration.md`.

The source tree now points docs production deployment to Cloudflare Pages. `docs:deploy` is a manual
Wrangler direct upload helper, and release workflow docs handling is build verification only.

### SYS-AUDIT-006: Capability Placement Was Too CLI-Centered

Status: resolved by [capability-placement.md](capability-placement.md) with follow-up backlog.

Evidence: PR #315 (`eb658beb4`) — "chore(harness): add capability placement scan". The
`capability-placement.md` architecture slice and harness scan were introduced in that PR.

Problem:

The CLI detail map strongly stated that CLI-visible behavior is not CLI-owned behavior, but the same
rule was not promoted as a repository-wide feature placement path. Future product shells, services,
or transports could repeat the same ownership mistake outside the CLI package.

Resolution:

The architecture map now has an owner-first capability placement slice. Product shells may render,
host, and wire concrete adapters, but reusable contracts, lifecycle state, provider semantics,
command behavior, background workspace projections, auth, credits, and transport-visible protocols
must be owned by lower reusable packages first. Follow-up backlog items track mechanical guard
coverage and focused audits for background workspace projection and app/server boundaries.

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
