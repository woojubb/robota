# DAG-002 — user-execution evidence (agent-run)

The scenario the task specifies: author a workflow whose nodes have meaningful **string** ids, execute
it through the product's workflow surface, and read the run record. Run by the agent on the real CLI
(`packages/dag-cli/dist/node/bin.js`, the `robota-dag` binary), not through a test harness.

## Setup

`greeting.dag.json` — two nodes named as a person would name them, joined on a named port:

```json
{
  "dagId": "user-execution-check",
  "version": 1,
  "status": "draft",
  "nodes": [
    { "nodeId": "greeting", "nodeType": "input", "dependsOn": [], "config": { "text": "hello" } },
    {
      "nodeId": "reply",
      "nodeType": "input",
      "dependsOn": ["greeting"],
      "config": { "text": "world" }
    }
  ],
  "edges": [
    { "from": "greeting", "to": "reply", "bindings": [{ "outputKey": "text", "inputKey": "text" }] }
  ]
}
```

## Observed, after the change

```
$ node packages/dag-cli/dist/node/bin.js run greeting.dag.json

[…] node:greeting status=success duration_ms=1
[…] node:reply status=success duration_ms=0
Running: greeting.dag.json
  ✓ greeting   [success]
  ✓ reply   [success]

Outputs:
  greeting.text: hello
  greeting._agentSummary: Input: 5 chars.
  reply.text: hello
  reply._agentSummary: Input: 5 chars.
```

Both the progress lines and the output keys name **`greeting`** and **`reply`** — the ids that were
written in the file. No companion file was involved.

## The contrast

The old contract took `IDagWorkflowFile`, so the caller converted down and the provider converted
straight back up. Running that same round trip on this same file:

```
authored node ids : greeting, reply
what the runtime  : node-1, node-2
```

Those `node-<n>` ids were what the run record showed. The port name survived here only because this
file names its ports; a slot with no name became `out0`/`in0`.

(The status in that round trip now reads `draft`. Before this change it read `'active'`, which is not
a member of `TDagDefinitionStatus` at all — the second half of the same defect.)

## Reproduce

```bash
pnpm build
node packages/dag-cli/dist/node/bin.js run <a definition with string node ids>
```

The backing regression test, which asserts the same observable on the `/workflows` path:

```bash
pnpm --filter @robota-sdk/agent-command-workflows exec vitest run \
  src/__tests__/execute-definition-preserves-ids.test.ts
```
