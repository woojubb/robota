---
status: draft
type: INFRA
tags: [architecture, cli]
---

# ARCH-PROVIDER-002: Stage A — split `agent-provider` into SDK-aligned leaf packages

Stage A of [`ARCH-PROVIDER-001`](ARCH-PROVIDER-001-provider-dip-architecture.md) (approved dual-lens,
2026-07-09). Closes **ARL-10 provider-half** + **ARL-15 provider husks**. Packaging inversion only — no
node/registry/DIP changes yet (those are Stages B–C); the LLM nodes keep constructing concrete providers
until Stage B, so this stage is independently shippable with the build green.

## Problem

`agent-provider` hard-depends on all three LLM SDKs (`@anthropic-ai/sdk`, `openai`, `@google/genai`) behind
per-vendor subpath exports; every importer pulls all three. The per-vendor split was intended (husk dirs
exist) but never executed. Split the monolith into SDK-aligned leaf packages so each consumer pulls only the
SDK(s) it uses.

## Solution (packaging inversion; `agent-provider/src/*` is already vendor-separated)

Create 5 leaf packages, each depending on `agent-core` + its one SDK, moving the existing `src/<vendor>` code
verbatim:

| Package                            | SDK                 | Contents (moved from `agent-provider/src/`)                                                                                      |
| ---------------------------------- | ------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `agent-provider-anthropic`         | `@anthropic-ai/sdk` | `anthropic/`                                                                                                                     |
| `agent-provider-openai`            | `openai`            | `openai/`                                                                                                                        |
| `agent-provider-openai-compatible` | `openai`            | `shared/openai-compatible/` + `deepseek/` + `qwen/` + `gemma/` as **provider-definition config entries** (one package, not four) |
| `agent-provider-gemini`            | `@google/genai`     | `gemini/` + `google/` facade                                                                                                     |
| `agent-provider-bytedance`         | (bespoke HTTP)      | `bytedance/` — `IVideoGenerationProvider` (media/video group)                                                                    |

- Relocate `createDefaultProviderDefinitions()` (currently `agent-provider/src/default-provider-definitions.ts`)
  into the **composition layer** — the sanctioned home is `agent-cli` (product tier) and/or a small composition
  module; it imports the vendor packages the product bundles. (Its final home for the DAG side is settled in
  Stage B/C via `dag-nodes-default`; Stage A moves it to the agent-side composition root so the monolith can be
  deleted.)
- **Repoint the 6 real consumers** from `@robota-sdk/agent-provider[/subpath]` to the specific vendor
  package(s): `agent-cli`, `agent-command-workflows`, `agent-subagent-runner`, `agent-playground`,
  `apps/agent-server`, `apps/starter-nextjs`. (Enumerate exhaustively via `rg "@robota-sdk/agent-provider"`.)
- **Delete** the `agent-provider` monolith package and the `agent-provider-gemma` husk (gemma folds into
  `-openai-compatible`).
- Changesets for every new/removed/edited published package (major for the removal + repoints; the SDK bundle
  change is breaking).

No `dag-node-llm-text-*` change in this stage — they keep importing their vendor provider, now from the
per-vendor package instead of the monolith subpath (a mechanical import repoint), so nothing regresses.

## Affected Files

- NEW: `packages/agent-provider-{anthropic,openai,openai-compatible,gemini,bytedance}/**` (package.json, src moved, docs/SPEC.md, tests moved)
- MOVED: `packages/agent-provider/src/{anthropic,openai,shared/openai-compatible,deepseek,qwen,gemma,gemini,google,bytedance,default-provider-definitions.ts}`
- EDITED: the 6 consumers' imports + `package.json` deps; `dag-node-llm-text-*` provider imports (monolith subpath → vendor package)
- DELETED: `packages/agent-provider/` (monolith), `packages/agent-provider-gemma/` (husk)
- `.changeset/*`, SPEC updates, `.agents/project-structure.md` (package listing), architecture-map provider entries

## Completion Criteria

- [ ] TC-01: the 5 leaf packages exist; each `package.json` depends on `agent-core` + exactly its one SDK (no cross-SDK bundling — verified per package).
- [ ] TC-02: `agent-provider` monolith + `-gemma` husk are deleted; no workspace package depends on `@robota-sdk/agent-provider` (grep clean).
- [ ] TC-03: all provider capabilities preserved — every `IProviderDefinition` previously returned by `createDefaultProviderDefinitions()` still resolves (anthropic/openai/deepseek/qwen/gemma/gemini/google/bytedance), asserted by a characterization test moved with the code.
- [ ] TC-04: `pnpm build` + full-repo `pnpm typecheck` + affected tests + `pnpm harness:scan` (incl. `dependency-direction`, `interface-runtime`, `ghost-package-refs`, `check-spec-public-surface`) all green; changesets present for every published package touched.
- [ ] TC-05: dependency isolation proven — `agent-provider-anthropic`'s install closure contains `@anthropic-ai/sdk` and NOT `openai`/`@google/genai` (and symmetrically), asserted mechanically.

## Test Plan

Characterization-first: before moving code, capture the current `createDefaultProviderDefinitions()` output
(provider `type`s + resolvable `createProvider`) as a golden test; after the split, the same set must resolve
from the composition layer (TC-03). Per-package SDK-isolation assertion (TC-05). Full-repo typecheck catches
every missed consumer (DATA-005 lesson). Land via the standard flow + `merge-verifier`; annotate ARL-10/ARL-15
progress on land. Sub-sequence commits: create packages → move code → repoint consumers → relocate
default-definitions → delete monolith/husk, keeping the build green at each step.

## Tasks

- [ ] 미생성 — GATE-APPROVAL 후 생성.

## Evidence Log
