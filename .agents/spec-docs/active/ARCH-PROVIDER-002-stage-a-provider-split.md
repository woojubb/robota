---
status: in-progress
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

| Package                            | SDK                 | Contents (moved from `agent-provider/src/`)                                                                                                                                                      |
| ---------------------------------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `agent-provider-anthropic`         | `@anthropic-ai/sdk` | `anthropic/`                                                                                                                                                                                     |
| `agent-provider-openai`            | `openai`            | `openai/`                                                                                                                                                                                        |
| `agent-provider-openai-compatible` | `openai`            | `shared/openai-compatible/` + `deepseek/` + `qwen/` + `gemma/`, exporting the concrete `DeepSeekProvider`/`QwenProvider`/`GemmaProvider` **classes** + their definitions (one package, not four) |
| `agent-provider-gemini`            | `@google/genai`     | `gemini/` + `google/`; **re-exports `GoogleProvider` via a `./google` entry** (it is imported more than `/gemini` — 14 vs 6 sites)                                                               |
| `agent-provider-bytedance`         | (bespoke HTTP)      | `bytedance/` — `IVideoGenerationProvider` (media/video group)                                                                                                                                    |

- **Aggregator home = a new published composition leaf `agent-provider-defaults`** (NOT `agent-cli` — that
  cycles: `agent-cli` already depends on `agent-command-workflows` + `agent-subagent-runner`, and
  `agent-subagent-runner` (a published library) needs the default definitions, so it cannot depend on
  `agent-cli`). Move `createDefaultProviderDefinitions()` there; it depends on the 4 LLM leaf packages
  (`-anthropic`/`-openai`/`-openai-compatible`/`-gemini`) and is consumed by `agent-cli`,
  `agent-subagent-runner`, and the `agent-command-workflows` test. This is the clean home the Stage B/C
  `dag-nodes-default` composition later mirrors.
- **Repoint ALL consumers (exhaustive — 15 workspace consumers, regenerated via
  `rg "@robota-sdk/agent-provider" packages/** apps/**`)** from `@robota-sdk/agent-provider[/subpath]` to the
  specific leaf package(s). Published (changeset owed): `agent-cli`, `agent-subagent-runner`. Private
  (`private:true`, repoint-only, no changeset): `agent-command-workflows`, `agent-playground`, `apps/agent-server`,
  `apps/starter-nextjs`, and the **9 `dag-nodes` consumers** that `new` a concrete provider —
  `dag-node-llm-text-{anthropic,openai,gemini,deepseek,qwen}` (1 vendor each), **`dag-node-instant-node` (5
  vendors → 4 leaf packages; on the LIVE `/workflows` path)**, `dag-node-gemini-image-edit` + `dag-node-text-to-image`
  (`/google` → `-gemini`), `dag-node-seedance-video` (`/bytedance`). Missing any of these fails full-repo
  typecheck (DATA-005) — enumerate up front, not via the safety net mid-deletion.
- **Delete** the `agent-provider` monolith and the `-gemma` husk (folds into `-openai-compatible`); also delete
  the `agent-provider-google` husk (the new package is `-gemini`; no `-gemini` husk exists — reconcile now so
  `ghost-package-refs`/`dependency-direction` stay clean).
- Changesets: `agent-provider` removal = **major**; `agent-cli` + `agent-subagent-runner` dep-shape change =
  **major**; the 5 leaves + `agent-provider-defaults` = initial. Private packages (all `dag-nodes/*`,
  `agent-playground`, apps) are repoint-only, no changeset.

No node BEHAVIOR change in this stage — every node keeps constructing its concrete provider, now imported from
the per-vendor leaf package instead of the monolith subpath (a mechanical import repoint). The DIP node collapse
is Stage B.

## Affected Files

- NEW: `packages/agent-provider-{anthropic,openai,openai-compatible,gemini,bytedance}/**` + `packages/agent-provider-defaults/**` (package.json, src moved, docs/SPEC.md, tests moved)
- MOVED: `packages/agent-provider/src/{anthropic,openai,shared/openai-compatible,deepseek,qwen,gemma,gemini,google,bytedance}` → leaves; `default-provider-definitions.ts` → `agent-provider-defaults`
- EDITED (imports + `package.json` deps): published — `agent-cli`, `agent-subagent-runner`; private (repoint-only) — `agent-command-workflows`, `agent-playground`, `apps/agent-server`, `apps/starter-nextjs`, and `dag-nodes/{llm-text-anthropic,llm-text-openai,llm-text-gemini,llm-text-deepseek,llm-text-qwen,instant-node,gemini-image-edit,text-to-image,seedance-video}`
- DELETED: `packages/agent-provider/` (monolith), `packages/agent-provider-gemma/` + `packages/agent-provider-google/` (husks)
- `.changeset/*`, SPEC updates, `.agents/project-structure.md` (package listing), architecture-map provider entries

## Completion Criteria

- [ ] TC-01: the 5 leaf packages + `agent-provider-defaults` exist; each leaf `package.json` depends on `agent-core` + exactly its one SDK (no cross-SDK bundling); `agent-provider-defaults` depends on the 4 LLM leaves only.
- [ ] TC-02: `agent-provider` monolith + `-gemma` + `-google` husks deleted; no workspace package depends on `@robota-sdk/agent-provider` (grep clean); no dependency cycle (`agent-subagent-runner` does NOT depend on `agent-cli`).
- [ ] TC-03: all provider capabilities preserved — every `IProviderDefinition` previously returned by `createDefaultProviderDefinitions()` still resolves (anthropic/openai/deepseek/qwen/gemma/gemini/google/bytedance); `-openai-compatible` exports the concrete `DeepSeek/Qwen/Gemma` classes and `-gemini` re-exports `GoogleProvider` via `./google` (so every node's `new Vendor()` compiles). Characterization test moved with the code.
- [ ] TC-04: `pnpm build` + full-repo `pnpm typecheck` + affected tests + `pnpm harness:scan` (incl. `dependency-direction`, `dag-nodes-leaf`, `interface-runtime`, `ghost-package-refs`, `check-spec-public-surface`) all green; changesets for `agent-provider`(major-removal) + `agent-cli` + `agent-subagent-runner`(major).
- [ ] TC-05: dependency isolation proven — `agent-provider-anthropic`'s install closure contains `@anthropic-ai/sdk` and NOT `openai`/`@google/genai` (and symmetrically), asserted mechanically.
- [ ] TC-06: the live `/workflows` path stays green — a `dag-node-instant-node` create+run scenario passes (it repoints 5 vendor providers → 4 leaf packages and is on that path).

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

- 2026-07-09 GATE-APPROVAL round 1 — proposal-reviewer REVISE (split direction endorsed; 2 correctness
  defects + 2 secondary). Fixed: (1) **consumer undercount** — 15 workspace consumers not 6; added the 4
  missed media/instant node consumers (`instant-node` [5 vendors, live `/workflows`], `gemini-image-edit`,
  `seedance-video`, `text-to-image`) — enumerated exhaustively, private=repoint-only, + TC-06 `/workflows`
  green. (2) **relocation cycle** — `agent-cli` is invalid (it depends on `subagent-runner`/`command-workflows`
  which need the aggregator); introduced a new published `agent-provider-defaults` leaf as the aggregator home
  (deps: 4 LLM leaves; consumers: agent-cli/subagent-runner/workflows-test). (3) `-openai-compatible` exports
  concrete DeepSeek/Qwen/Gemma **classes**; `-gemini` re-exports `GoogleProvider` via `./google`. (4) delete
  the `-google` husk too (no `-gemini` husk). Confirmed TRUE: DAG doesn't consume the aggregator, openai-compat
  one-package, bytedance/google folding, changeset scope (private nodes repoint-only).
- 2026-07-09 GATE-APPROVAL round 2 — proposal-reviewer **ENDORSE**. All 4 fixes confirmed against code
  (15 consumers exhaustive incl. instant-node on live /workflows; `agent-provider-defaults` leaf resolves
  the agent-cli cycle; concrete class exports; `-google` husk deleted). Non-blocking: `agent-command-workflows`
  takes a **devDep** (test-only) on `agent-provider-defaults`. Approved → implement (push-deferred).
