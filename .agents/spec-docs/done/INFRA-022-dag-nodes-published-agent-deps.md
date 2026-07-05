---
status: done
type: INFRA
tags: [typescript]
---

> **Done (2026-06-30) — integrated to workspace** (user chose integrate over decouple). The 7 absorbed
> LLM/image node packages were re-pointed off the published `@robota-sdk/agent-*@3.0.0-beta.61` deps:
> `@robota-sdk/agent-core` → `workspace:*`; the separate `@robota-sdk/agent-provider-<vendor>` deps →
> the workspace `@robota-sdk/agent-provider` umbrella, imports switched to its subpaths
> (`@robota-sdk/agent-provider/anthropic|openai|google|deepseek|qwen`). Added
> `moduleResolution: "bundler"` to those node tsconfigs (subpath-exports resolution, matching agent-cli).
> No more duplicate/published `agent-core`; the vulnerable `@anthropic-ai/sdk@0.80` path is gone, so the
> tactical `pnpm.overrides` band-aid for it was **removed**. `pnpm build` + workspace `typecheck` +
> dag-node/dag-cli/dag-framework tests + `pnpm audit --audit-level high` + `harness:scan` 39/39 all green.

# INFRA-022: Re-point absorbed dag-node packages off published @robota-sdk/agent-\* deps

## Problem

The absorbed LLM/image node packages depend on **published, version-pinned** `@robota-sdk/agent-*`
packages from npm instead of the workspace, and on provider packages that do **not exist** in this
monorepo:

- `@robota-sdk/agent-core@3.0.0-beta.61` (pinned to a published version, not `workspace:*`).
- `@robota-sdk/agent-provider-anthropic@3.0.0-beta.61`, `-openai`, `-google`, `-deepseek`,
  `-qwen@3.0.0-beta.61` — the monorepo uses the `agent-provider` umbrella (subpath imports), so these
  separate `agent-provider-<vendor>` packages are **not workspace members**; they come from npm.

Affected node packages: `dag-nodes/{llm-text-anthropic,llm-text-openai,llm-text-gemini,llm-text-deepseek,llm-text-qwen,gemini-image-edit,instant-node}`.

Consequences:

- The DAG node layer is **not integrated** into the monorepo's agent layer — it pulls released SDK
  versions rather than the local workspace ones.
- Versions are **frozen at beta.61** and will drift as the workspace `agent-*` advance.
- The published path drags its own transitive deps, including the vulnerable `@anthropic-ai/sdk@0.80.0`
  that the `pnpm.overrides` entry now patches (a tactical patch over the structural gap).
- Duplicate installs of `@robota-sdk/agent-core` (workspace + published beta.61).

This was introduced by the WORKFLOW-001 absorption (robota-dag was self-contained and depended on the
published SDK); the absorption did not reconcile these edges to the workspace.

## Decision needed (product/architecture)

Two coherent directions — needs a call before implementation:

1. **Integrate** — re-point the node packages to the workspace agent layer (`workspace:*` `agent-core`;
   replace `agent-provider-<vendor>` with the `agent-provider` umbrella subpaths). Pro: true monorepo
   integration, single version, no published-dep drift. Con: API reconciliation between published
   beta.61 and the current umbrella; touches 7 node packages.
2. **Deliberately decouple** — keep the DAG node layer on the released SDK on purpose (DAG depends on
   stable published agent-\*, not bleeding-edge workspace). Then document the boundary and pin/maintain
   the versions intentionally (and remove the umbrella mismatch by confirming the `agent-provider-<vendor>`
   packages are a supported published surface).

## Notes

Draft backlog item (pre-GATE-WRITE). The `@anthropic-ai/sdk` override and the vitest 3.2.6 alignment
already landed as security fixes; this item is the structural follow-up they sit on top of.
