# WORKFLOW-004 — `/workflows build` authors + saves for review, never executes

**Spec:** `.agents/spec-docs/done/WORKFLOW-004-workflows-build-subcommand.md`
**Type:** agent-executable (the agent runs the real CLI / real executors itself; no owner action).
**Contract:** `build` = author → validate → save — NEVER execute. The saved artifact is then driven
through the existing explicit steps (`validate`, `run`) and appears in `catalog`.

## Scenario A — deterministic stub provider (no network, no keys)

Driver: a node script against the built package (`dist/node/index.js`) in a scratch project —
`executeWorkflowsBuild` via the FLOW-007 `resolveProvider` stub seam (fixed authored spec:
input → text-trim → text-upper → text-output), then `validate` / `run` / `catalog` through the
REAL module dispatch (`createWorkflowsCommandModule().systemCommands[0].execute`).

**Observed (2026-07-25, scratch `/tmp/wf004-stub-UkaojW`):**

```
--- build result (success=true) ---
Built "trim-upper" (4 node(s), 3 edge(s)) — saved, not run.
Saved: /tmp/wf004-stub-UkaojW/.workflows/trim-upper.json
Next steps:
  /workflows validate /tmp/wf004-stub-UkaojW/.workflows/trim-upper.json
  /workflows run /tmp/wf004-stub-UkaojW/.workflows/trim-upper.json
--- artifact inspection ---
dagId: trim-upper | nodes: 4 | edges: 3
input node config: {"text":" hi "}
--- /workflows validate (success=true) ---
Valid workflow "...trim-upper.json": 4 node(s), 3 edge(s).
--- /workflows run (success=true) ---
Workflow completed in 4ms.
Outputs: { ... "node-3.text": "HI", "node-4.text": "HI" ... }
--- /workflows catalog (success=true) ---
Workflows in .workflows (1):
  trim-upper.json — 4 node(s), 3 link(s)
STUB-SCENARIO-PASS
```

✅ PASS — build reports the saved path + next-step hints with NO run output; the artifact carries
the baked `--input` (`" hi "`); `run` (the explicit step) produces `HI`.

## Scenario B — live provider (real Anthropic API), full CLI surface

Prereq: built agent-cli (`packages/agent-cli/bin/robota.cjs`), `ANTHROPIC_API_KEY` in env, scratch
project `/tmp/wf004-live-i59hqN`.

```bash
node packages/agent-cli/bin/robota.cjs -p '/workflows build "trim then uppercase the input text" --input text=" hi "'
```

**Observed (2026-07-25, live Anthropic `claude-sonnet-4-6`):**

```
Built "trim-then-uppercase" (4 node(s), 3 edge(s)) — saved, not run.
Saved: /tmp/wf004-live-i59hqN/.workflows/trim-then-uppercase.json
Next steps:
  /workflows validate /tmp/wf004-live-i59hqN/.workflows/trim-then-uppercase.json
  /workflows run /tmp/wf004-live-i59hqN/.workflows/trim-then-uppercase.json
EXIT=0
```

Artifact inspected before any run: the LIVE model authored the correct 4-node graph
(`input → text-trim → text-upper → text-output`, 3 bound edges) and `--input text=" hi "` is baked
into the `input` node config — no run output existed at this point (no `Outputs:`/duration line;
nothing but the saved file on disk).

Then each explicit next step, same CLI:

```
/workflows validate <path> → Valid workflow "...trim-then-uppercase.json": 4 node(s), 3 edge(s).   EXIT=0
/workflows run <path>      → Workflow completed in 6ms.  Outputs: { ... "node-4.text": "HI" ... }  EXIT=0
/workflows catalog         → Workflows in .workflows (1): trim-then-uppercase.json — 4 node(s), 3 link(s)  EXIT=0
```

✅ PASS — the generate-for-review shape works on the real surface: `build` saved a reviewable
artifact and executed nothing; `run` was the separate, explicit step that produced `HI`.

## Non-execution proof (mechanical)

`packages/agent-command-workflows/src/__tests__/build-command.test.ts` spies
`LocalDagRuntimeProvider.prototype.execute` (the only in-process DAG execution entry) in every test
and asserts **0 calls** across all `build` paths (TC-01/02/03/04/05); the TC-02 round-trip asserts
the count goes 0 → 1 only when the explicit `run` executes the artifact.
