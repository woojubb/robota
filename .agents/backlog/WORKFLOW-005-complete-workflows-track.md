---
title: 'WORKFLOW-005: complete the /workflows feature (dynamic node+workflow authoring; DAG stays private)'
status: todo
created: 2026-07-05
approved: 2026-07-05
start_phase: 'P1 — node-kind completion (owner-approved 2026-07-05)'
priority: medium
urgency: soon
area: packages/agent-command-workflows, packages/dag-nodes, packages/dag-node, packages/dag-cli
depends_on: ['CLI-077', 'WORKFLOW-004']
---

# Complete the /workflows feature (Option A — feature completion, DAG kept private)

Owner decision (2026-07-05): complete the **feature** in the dev/private context; the DAG subsystem
stays `private` (no publish, no IP exposure) until a separate instruction. So the published CLI keeps
CLI-077's optional/absent `/workflows`; this item advances the capability itself.

## Vision

Dynamically create workflows AND workflow nodes on the fly. A node can be a **skill**, a **tool call**,
an **LLM** call, **generative AI** (image/video), or an arbitrary **custom function** — all on one
common node interface. Anything created is **reusable** and **savable** to disk for reload. (Similar in
spirit to Claude Code workflows; this predates it and is now being solidified.)

## Current state (research 2026-07-05)

- **Common interface already exists** — `IDagNodeDefinition` + `INodeTaskHandler`
  (`packages/dag-core/src/types/node-lifecycle.ts`); every node conforms. Authoring via
  `AbstractNodeDefinition` / `defineDagNode` (`packages/dag-node/src/lifecycle/`). The "common
  interface" requirement is structurally satisfied.
- **Dynamic node creation exists, partially** — `instant-node` builds nodes from data at runtime:
  `createPromptBackedNodeDefinition` (LLM-prompt node) and `createCompositeInstantNodeDefinition`
  (wrap an inner DAG). Phase C (arbitrary code node via API) is explicitly out of scope today.
- **Node catalog** — a static hand-maintained registry (`dag-framework/src/default-node-registry.ts`):
  LLM text (anthropic/openai/gemini/deepseek/qwen/router), gemini image edit/compose, mcp-tool
  (external MCP-over-HTTP), file/http/transform/text/utility nodes.
- **Persistence exists but fragmented** — `.dag/workflows/*.dag.json` (workflows),
  `.dag/nodes/*.instant-node.json` (prompt nodes), `*.dag.node.js` (code nodes). Three formats.
- **Builder is pipeline-only** — `buildDagFromPipeline` (linear + parallel fan-out, auto-wired); no
  free-form graph/branch builder.
- **Two surfaces** — the thin `/workflows` slash command (`list`/`catalog`/`validate`/`run`) vs the
  rich `dag-cli` **MCP** toolset (build, instant-node CRUD+save, export/import, templates). The
  dynamic-creation power lives only in the MCP layer, not the agent slash command.

## Gaps to close (the "완성" work)

1. **Missing node kinds on the common interface** (each is an additive `IDagNodeDefinition`):
   - **skill node** — wrap a Robota skill (MISSING).
   - **in-process tool node** — wrap the agent `agent-tools` FunctionTool registry (only external
     MCP-over-HTTP `mcp-tool` exists today).
   - **custom-function / code node** — instant-node **Phase C**: define behavior via API at runtime,
     persistable (today custom code requires hand-writing a `*.dag.node.js` file).
   - **generative image (text-to-image)** and **generative video** — image is edit/compose only;
     video MISSING (payload already supports `binaryKind: 'video'`).
2. **Fix + unify persistence** — composite/instant nodes with `taskCode: null` are dropped on reload
   (`dag-cli/.../instant-nodes.ts`); unify "save this node OR workflow, reload it" into one abstraction.
3. **Expose dynamic creation through `/workflows`** — bring create-node / save / build to the agent
   slash command (or a shared authoring API the slash command and MCP both use), so the agent can
   create and reuse nodes+workflows on the fly, not only via MCP.
4. **WORKFLOW-004 `build` subcommand** — LLM-assisted workflow authoring (its own spec-first sub-item).

## Proposed phasing (to confirm)

- **P1 — node-kind completion**: skill node + in-process tool node + text-to-image/video nodes
  (additive, common interface). Highest vision value, lowest risk.
- **P2 — dynamic authoring**: instant-node Phase C (code node via API) + unified persistence + fix
  composite reload.
- **P3 — surface unification**: expose create/save/build through `/workflows` (+ WORKFLOW-004 build).

Deferred (separate instruction): making the DAG subsystem publishable so `/workflows` ships in the
CLI (WORKFLOW-005 does NOT publish anything).

## Test Plan

- Per new node: a `defineDagNode`/lifecycle unit test + a functional run through
  `LocalDagRuntimeProvider.execute` with a scripted provider; boundary `rg` stays 0.
- Persistence: save→reload round-trip for prompt, composite, and code nodes (composite reload fixed).
- No published-closure change (CLI-077 invariant holds; DAG stays private).

## User Execution Test Scenarios

- agent-executable (dev/monorepo, DAG present). Create a node of each kind on the fly, save it, reload,
  compose a small workflow using it, and run it end-to-end via the dev `/workflows` path.
- Evidence: _to fill at implementation._

## P1 implementation notes — node #1: in-process tool node (grounded 2026-07-05)

Design confirmed by research; ready to implement (SPEC-first → TDD → live UE).

- **Package**: `@robota-sdk/dag-node-tool` at `packages/dag-nodes/tool`, `private: true` (DAG subsystem
  stays private). Scaffold by mirroring `packages/dag-nodes/mcp-tool` (package.json, tsconfig,
  tsdown.config, vitest.config, src/index.ts, docs/SPEC.md, README).
- **Boundary**: distinct from the existing `mcp-tool` node (external MCP-over-HTTP/stdio). This node
  wraps the agent's **in-process** `@robota-sdk/agent-tools` builtins as a DAG step.
- **Pattern**: `class ToolNodeDefinition extends AbstractNodeDefinition<typeof ConfigSchema>` (from
  `@robota-sdk/dag-node`), **no-arg constructor** (same as the LLM nodes — runtime params come from the
  node `config`, not injection). Import `@robota-sdk/agent-tools` directly (dag-nodes may depend on
  agent packages — instant-node already depends on agent-core).
- **config (zod)**: `toolName: z.string().min(1)` selecting a builtin (`read`/`write`/`edit`/`glob`/
  `grep`/`shell`/`bash`/`web-fetch`/`web-search`/…), optional `params` (static tool args merged under
  the input), `baseCredits`. Map `toolName` → the agent-tools factory (e.g. `createReadTool`,
  `createShellTool`, …) — a static switch, mirroring how the LLM node constructs its provider.
- **ports**: input `params` (JSON string, optional) → merged with config params → tool parameters;
  outputs `output` (string, from `IToolResult.output`) + `isError` (boolean). defaultInput=`params`,
  defaultOutput=`output`.
- **execute**: `NodeIoAccessor` to read input; construct the selected builtin tool; call
  `tool.execute(mergedParams)`; on `result.success` emit `{ output, isError:false }`, else
  `buildTaskExecutionError(...)` (or emit `{ output: error, isError:true }` per validate/output policy).
  Unknown `toolName` → `buildValidationError` with the allowed list as `options`.
- **registry**: add to the SYNC list in `packages/dag-framework/src/default-node-registry.ts`
  (`createDefaultNodeRegistrySync`) — agent-tools loads without an optional provider SDK.
- **New-package harness gotchas** (learned from agent-process/CORE-023): register in
  `.agents/project-structure.md` package listing; add to `check-capability-placement.mjs` family rule;
  create `docs/README.md` pointing to SPEC.md; mark any illustrative README code blocks
  `<!-- doc-example-skip -->`; the package is `private:true` so the dist-freshness scan skips it
  (fixed in the beta.77 release).
- **Tests (TDD)**: node lifecycle unit test (config parse, port defs, unknown-tool validation) + a
  functional run through `LocalDagRuntimeProvider.execute` on a 1-node workflow that invokes a safe
  builtin (e.g. `grep`/`read` in a temp dir) and asserts the output port.
- **Live UE**: dev `/workflows` — build/run a `.dag.json` with a `tool` node (e.g. read a temp file)
  and confirm the output; boundary `rg` for forbidden imports stays 0.

Then repeat the pattern for the remaining P1 nodes: **skill node** (wrap a Robota skill), **text-to-image**
(extend the gemini-image pattern with a from-scratch generate), **video** (new generative node;
`binaryKind: 'video'` payload already supported).
