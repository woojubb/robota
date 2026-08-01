---
title: 'DAG-002: the DAG''s top-level "run a DAG" contract is typed on the imported system''s file format, and the conversion is lossy in both directions'
status: todo
created: 2026-08-02
priority: critical
urgency: now
area: packages/dag-core, packages/dag-builder, packages/dag-framework, packages/agent-command-workflows
depends_on: []
---

# DAG-002: the domain SSOT is bypassed at the one entry point that matters

## Problem

The one entry point that matters — "run a DAG" — is typed on a **foreign serialization format**, not
on the domain model, and the conversion through it loses information in both directions: node ids are
fabricated, port keys are invented, and a status value is produced that is **not a member of its own
union**. All of it is silent.

The round trip is also pointless in every production path: the caller already holds the canonical
`IDagDefinition`, converts it to the foreign format, and the provider immediately converts it back.
The packages above document their workarounds in their own comments.

## Evidence

**Layer: L5 (DAG).** L5 F2:

- `packages/dag-core/src/types/runtime-provider.ts:108-117` — `IDagRuntimeProvider.execute(dag:
IDagWorkflowFile, …)`, where `IDagWorkflowFile` (`types/workflow-file.ts:58-68`) is the foreign
  serialization: `last_node_id`, numeric node ids, `links: [number,number,number,number,number,string]`,
  `widgets_values`, `"Format version. Current: 0.4"`.
- `packages/dag-builder/src/dag-workflow-converter.ts` is not information-preserving: `:111`
  (`const portTypeStr = 'STRING'; // all ports are STRING-typed in workflow format`), `:253-254`
  (output/input keys **invented** as `out${i}`/`in${i}`), `:281`
  (`status: (companion?.status ?? 'active') as TDagDefinitionStatus` — **`'active'` is not a member of
  `TDagDefinitionStatus`**, `domain.ts:2`), `:207` (`node-${wfNode.id}` destroying string node ids).
- The workaround is written down above it:
  `packages/agent-command-workflows/src/authoring/execute-workflow.ts:29-31` and
  `persistence/instant-node-loader.ts:52-54,69-75` — the latter rebuilding a `node-<n> → <originalId>`
  map from a companion file produced purely to survive the round-trip.
- The round-trip is _pointless_ in every production path: the caller holds an `IDagDefinition`, calls
  `toDagWorkflowFile` (`execute-workflow.ts:31`), and the provider immediately calls
  `fromDagWorkflowFile` (`local-dag-runtime-provider.ts:107`, `http-dag-runtime-provider.ts:146`).

The cause in one sentence, from the synthesis: _an absorbed system's wire format was placed in the
domain package and then used as the execution contract, so the canonical model is serialized to a
lossier one and back between two callers who both already hold it._

## Why this is foundational (or not)

**FOUNDATIONAL — `dag-core`.** Single layer (L5), because no other auditor's scope reaches
`dag-core`. The synthesis ranks it **BLOCKER**: the domain SSOT is bypassed at the one entry point
that matters, and the loss is silent — fabricated ids, invented port keys, and a status value outside
its own union.

The strongest corroboration inside the finding is not a second auditor but the code itself: the
packages _above_ the converter have written their workarounds into their own comments
(`execute-workflow.ts:29-31`, `instant-node-loader.ts:52-54,69-75`), including a companion file that
exists purely to survive the round trip.

## Direction

The invariant the synthesis states for this class (theme T9): _knowledge flows toward the more stable
abstraction_ — an absorbed system's wire format does not belong in the domain package, and it
certainly does not belong as the execution contract.

What the synthesis establishes:

- `IDagRuntimeProvider.execute` (`runtime-provider.ts:108-117`) should be typed on the canonical
  domain model, not on `IDagWorkflowFile` (`workflow-file.ts:58-68`).
- The round trip is **removable outright** in every production path, because both callers already
  hold an `IDagDefinition` (`execute-workflow.ts:31` → `local-dag-runtime-provider.ts:107` /
  `http-dag-runtime-provider.ts:146`). This is the cheapest correct fix the finding contains.
- The companion-file mechanism (`instant-node-loader.ts:52-54,69-75`) exists only to rebuild what the
  conversion destroyed, so removing the conversion removes the reason for it.

The synthesis does not decide where `IDagWorkflowFile` should live once it is no longer the execution
contract (import/export adapter vs. deletion) — that choice is open.

Risk it names: the conversion is lossy **in both directions**, and one of its outputs (`:281`,
`status: 'active'`) is already outside `TDagDefinitionStatus` (`domain.ts:2`), so any stored artifact
produced through this path may contain values the domain type says cannot exist. Migrating stored
workflows is part of the risk surface, not an afterthought.

## Test Plan

- **Required red-first regression:** round-trip an `IDagDefinition` with **string** node ids and
  named output ports through `toDagWorkflowFile` → `fromDagWorkflowFile` and assert the result equals
  the input. Against current code this must FAIL — `:207` rewrites ids to `node-${wfNode.id}` and
  `:253-254` invents `out${i}`/`in${i}` keys.
- Red-first: assert no code path can produce a `TDagDefinitionStatus` outside its union
  (`dag-workflow-converter.ts:281` produces `'active'`, `domain.ts:2` does not contain it) — a type
  test plus a runtime assertion, since the current site launders it through an `as` cast.
- Red-first: assert `IDagRuntimeProvider.execute` accepts the canonical model, and that the
  production paths (`execute-workflow.ts:31`, `local-dag-runtime-provider.ts:107`,
  `http-dag-runtime-provider.ts:146`) no longer convert.
- Assert the companion-file id map (`instant-node-loader.ts:52-54,69-75`) is no longer required for
  correct execution.
- `pnpm harness:verify-like-ci` green.

## User Execution Test Scenarios

**Applies.** Workflow authoring and execution are a user-facing surface, and the loss is observable:
a workflow authored with string node ids does not round-trip.

- **Prerequisites:** built `robota` CLI with the workflow surface. A workflow with **string** node ids
  and named output ports is needed; the workflow authoring surface already exists and this definition
  will be authored as part of this work.
- **Steps:**
  1. Author a workflow whose nodes have meaningful string ids and named output ports.
  2. Execute it through the product's workflow surface.
  3. Inspect the run record / node results and the persisted definition.
- **Expected observable result (after the fix):** the run record names the **original** string node
  ids and the **original** port names; no companion file is required to interpret it; the persisted
  definition's status is a valid domain status.
- **Expected observable result (before the fix, for contrast):** node ids appear as `node-<n>`, port
  keys appear as `out0`/`in0`, and a companion file is needed to map them back.
- **Cleanup:** delete the scratch workflow and its run state.
- **Evidence (fill in after implementation):** the authored definition and the run record side by
  side, showing ids and port names preserved.
