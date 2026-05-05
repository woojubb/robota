---
title: INFRA-BL-012 Architecture Map System Audit and Target Refactor Plan
status: backlog
priority: high
urgency: next
created: 2026-05-05
packages:
  - agent-cli
  - agent-sdk
  - dag-api
  - dag-cli
  - dag-mcp-server
  - dag-orchestrator-server
---

# INFRA-BL-012 Architecture Map System Audit and Target Refactor Plan

## Objective

Update the relevant `ARCHITECTURE-MAP.md` documentation with the newly introduced structure, then use
that source-backed map to audit the actual system architecture: package layers, ownership boundaries,
dependency edges, class/interface contracts, and cross-package responsibilities. The goal is a better
architecture plan, not merely a cleaner document layout.

## Problem

Recent work added and changed architecture-relevant structure:

- CLI built-in command packages and SDK command/common API ownership.
- Provider/model state flow and provider model catalog ownership.
- `@robota-sdk/dag-cli` as an orchestration API command-line client.
- `@robota-sdk/dag-mcp-server` as an MCP surface for orchestration API operations.
- `@robota-sdk/dag-api` as the shared orchestration HTTP client owner.
- Deployment and docs publishing changes around Cloudflare Pages and release workflow expectations.

The current package-local `packages/agent-cli/docs/ARCHITECTURE-MAP.md` is CLI-focused. It must be
updated for new CLI-relevant structure, but global DAG/orchestration/deployment ownership should not
be forced into a CLI-local map if the audit shows it needs a repo-level architecture map.

## Recommended Direction

Use two architecture-map layers if the source audit confirms the scope spans beyond `agent-cli`:

1. Keep `packages/agent-cli/docs/ARCHITECTURE-MAP.md` as the package-local CLI composition map.
2. Add or update a repo-level `ARCHITECTURE-MAP.md` under `.agents/specs/` for cross-package
   architecture spanning CLI, SDK, DAG orchestration, MCP, deployment, and documentation publishing.
3. Link the repo-level map from `.agents/project-structure.md` so future agents can find it before
   refactoring package boundaries.

This avoids hiding global architecture truth inside the CLI package while still satisfying the
requirement that architecture maps stay current with new package composition and ownership changes.

## Plan

- [ ] Verify current maps against source imports, package manifests, package `docs/SPEC.md` files,
      and `.agents/project-structure.md`.
- [ ] Update `packages/agent-cli/docs/ARCHITECTURE-MAP.md` for all new CLI-relevant command, SDK,
      provider/model, session, runtime, and host-adapter structure.
- [ ] Decide, from source evidence, whether a repo-level `.agents/specs/ARCHITECTURE-MAP.md` is
      required for DAG/orchestration/deployment architecture.
- [ ] If required, create the repo-level map with LLM-scannable diagrams, dependency trees, and
      explicit ownership tables.
- [ ] Audit contradictions in the actual architecture:
      forbidden or surprising dependency edges, duplicated contracts, pass-through ownership,
      UI concerns leaking into SDK/session layers, runtime concerns bypassing ports, and deployment
      workflow ownership drift.
- [ ] Recommend the target architecture with explicit layer ownership and allowed dependency edges.
- [ ] Update architecture docs to describe both the verified current state and the recommended
      target architecture.
- [ ] Split confirmed refactors into actionable follow-up backlog items with package/file scope,
      acceptance criteria, and verification commands.
- [ ] Update repository rules or common-mistakes guidance only for durable lessons that should apply
      beyond this task.

## Acceptance Criteria

- [ ] The relevant `ARCHITECTURE-MAP.md` file or files reflect the latest CLI, SDK, DAG CLI, DAG MCP,
      shared orchestration API client, and deployment/doc publishing structure.
- [ ] The audit distinguishes document-structure improvements from actual architecture improvements.
- [ ] The target architecture identifies the correct owner for each cross-package contract.
- [ ] Package boundaries are checked against source imports, package manifests, and package specs.
- [ ] Any recommended refactor is backed by a specific contradiction or maintainability risk.
- [ ] Follow-up refactor backlog items are created for every confirmed system change.
- [ ] The architecture map includes an update policy for future package composition changes.

## Test Plan

- `rg -n "from '@robota-sdk|from \"@robota-sdk" packages apps`
- `pnpm harness:scan:deps`
- `pnpm harness:scan:commands`
- `pnpm harness:scan:specs`
- `pnpm docs:build`

If implementation refactors are included in a later task, also run affected package
`test`, `typecheck`, `lint`, and `build` commands plus `pnpm harness:verify -- --base-ref origin/develop --skip-record-check`.

## Notes

- Do not edit generated `content/api-reference/**` output while updating docs.
- Do not preserve legacy layering if a cleaner beta architecture is available and verified.
- Do not treat `agent-cli` as the owner of reusable command, provider, orchestration, session,
  runtime, MCP, or deployment contracts.
