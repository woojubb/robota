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

## P1 progress log

- **node #1 — in-process tool node — DONE (2026-07-05).** Package `@robota-sdk/dag-node-tool`
  (`packages/dag-nodes/tool`, `private: true`). `ToolNodeDefinition` (nodeType `tool`) wraps the
  `@robota-sdk/agent-tools` builtins (`read`/`write`/`edit`/`shell`/`bash`/`glob`/`grep`/`web-fetch`/
  `web-search`) as a DAG step via a static allowlist (`TOOL_NODE_ALLOWED_TOOLS`). Config `toolName` +
  `params` (input port merged over config) + `cwd` + `baseCredits`; ports `output`/`isError`.
  Registered in `createDefaultNodeRegistrySync` (sync tier — no optional provider SDK). SPEC at
  `packages/dag-nodes/tool/docs/SPEC.md`.
  - Tests: 12 unit tests (lifecycle/config/unknown-tool/invalid-params/read/merge/soft-error) +
    1 functional integration test in dag-framework running a 1-node `tool` workflow through
    `LocalDagRuntimeProvider.execute` (`tool-node-run.test.ts`) + registry test asserts `tool` present.
    Full suites green: dag-node-tool 12, dag-framework 111.
  - Live UE evidence: `read` builtin via the provider path returned
    `{ ok: true, "node-1.output": "[File: …/note.txt (2 lines)]\n1\thello from the tool node\n2\tsecond line", "node-1.isError": false }`.
  - Boundary: CLI-077 holds — `agent-cli` published closure still has 0 dag/workflow deps
    (`dag-node-tool` and `dag-framework` are private and not in agent-cli's graph); capability-placement
    and agent-server-boundary scans pass. `dag-nodes/*` family rule auto-covers the new package.
  - Branch: `feat/workflow-005-p1-tool-node`. Merged via PR #965 → develop.

- **skill node — research done, DEFERRED (2026-07-05).** Investigation found a "Robota skill" is NOT a
  pure in-process function like a tool: a skill is a `SKILL.md` parsed into an `ICommand`; there is no
  `Skill` executor class. `executeSkill()` (in `@robota-sdk/agent-framework`) returns a **prompt string**
  in `inject` mode (default) — only an agent LLM turn produces a result — and only `fork`-context skills
  yield a standalone `result`, via `runSkillInFork` → `createSubagentSession` → `Session.run()` (a full
  LLM loop needing a provider + agent runtime deps). So a skill node is an **LLM-backed agent node**, not
  a tool-node clone. Owner (2026-07-05) chose to do text-to-image/video first and design the skill node
  as an explicit LLM-backed node later. Do NOT model it as a cheap deterministic step.

- **node #2 — text-to-image node — DONE (2026-07-05).** Package `@robota-sdk/dag-node-text-to-image`
  (`packages/dag-nodes/text-to-image`, `private: true`), mirroring the `gemini-image-edit` skeleton but
  pure generation (no input image). `TextToImageNodeDefinition` (nodeType `text-to-image`, category `AI`):
  single `text` input port, single binary `image` output port (`IMAGE_COMMON`); config `{ model,
baseCredits(=0.02) }`. `TextToImageRuntime.generateImage({prompt,model})` → `@robota-sdk/agent-provider/google`
  `GoogleProvider.generateImage` (already a required provider method); creds `GEMINI_API_KEY`, default model
  `DAG_TEXT_TO_IMAGE_DEFAULT_MODEL`, allowlist `DAG_TEXT_TO_IMAGE_ALLOWED_MODELS`; output normalized to an
  `IPortBinaryValue`. Registered in the **async/optional** loader list in `default-node-registry.ts` (Gemini
  SDK optional). SPEC at `packages/dag-nodes/text-to-image/docs/SPEC.md`.
  - Tests: 12 node-definition tests (mock runtime) + 7 runtime tests (mock `GoogleProvider`, incl. success
    normalization / missing-model / missing-key / model-not-allowed / provider-failure / empty-outputs /
    config-model-override) + registry test asserts `text-to-image` in the async registry. Full suites green:
    text-to-image 19, dag-framework 112. typecheck + lint clean (0 problems).
  - Live UE (no `GEMINI_API_KEY` available; real generation needs credentials + network — same constraint as
    gemini-image-edit, whose tests also mock the provider): built an `input → text-to-image` workflow and ran
    it through `LocalDagRuntimeProvider.execute` with the async registry. Evidence: `text-to-image in runtime
catalog: true`; the node is reached, resolves config, and returns the graceful validation error
    `GEMINI_API_KEY must be configured for text-to-image node runtime` (deepest reachable point without creds).
    Note: like `gemini-image-edit`, the runtime requires `DAG_TEXT_TO_IMAGE_DEFAULT_MODEL` even when
    `config.model` is set (mirrored behavior).
  - Boundary: CLI-077 holds (agent-cli still 0 dag/workflow deps); capability-placement + agent-server-boundary
    scans pass.
  - Branch: `feat/workflow-005-p1-text-to-image`.
