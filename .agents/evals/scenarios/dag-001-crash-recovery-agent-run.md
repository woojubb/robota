# DAG-001 — two-process crash recovery through `createDagFramework` (agent-run)

This scenario drives the public in-process DAG framework surface from two separate Node.js processes.
The first process creates and starts a two-node run, then is killed while the first node is executing.
The second process reopens the same file-backed framework state and observes recovery through
`framework.client.getRunStatus(...)`.

## Executability

`agent-executable` — the complete flow is non-interactive Bash, needs no credentials or external
service, and uses the repository's public `createDagFramework` export rather than an internal test
harness.

## Prerequisites

- Run from the repository root with the workspace dependencies installed.
- Bash, Node.js, and pnpm must be available.
- The process must be allowed to send `SIGKILL` to a child process it started.
- `scratch/src/` must be writable. The command materializes its disposable fixture there because that
  is the repository-owned home for live-verification scripts.
- No live provider credentials or network service is required.

## Exact command

```bash
set -euo pipefail

scenario_root="$(mktemp -d /tmp/robota-dag001.XXXXXX)"
scenario_script="scratch/src/dag-001-crash-recovery-agent-run.ts"
start_pid=""

cleanup() {
  if [[ -n "${start_pid:-}" ]] && kill -0 "$start_pid" 2>/dev/null; then
    kill -KILL "$start_pid" 2>/dev/null || true
    wait "$start_pid" 2>/dev/null || true
  fi
  rm -f -- "$scenario_script"
  case "$scenario_root" in
    /tmp/robota-dag001.*) rm -rf -- "$scenario_root" ;;
    *) printf 'refusing unexpected cleanup path: %s\n' "$scenario_root" >&2; return 1 ;;
  esac
}
trap cleanup EXIT

mkdir -p "$(dirname "$scenario_script")"
tee "$scenario_script" >/dev/null <<'TYPESCRIPT'
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { z } from 'zod';

import type { IDagDefinition, ITaskRun } from '../../packages/dag-core/src/index.ts';
import { createDagFramework } from '../../packages/dag-framework/src/index.ts';
import { defineDagNode } from '../../packages/dag-node/src/index.ts';

const [, , mode, rootArg] = process.argv;
if ((mode !== 'start' && mode !== 'resume') || rootArg === undefined) {
  throw new Error('usage: dag-001-crash-recovery-agent-run.ts <start|resume> <scenario-root>');
}

const scenarioRoot = path.resolve(rootArg);
const storageRoot = path.join(scenarioRoot, 'storage');
const assetRoot = path.join(scenarioRoot, 'assets');
const startedPath = path.join(scenarioRoot, 'first-node-started');
const runIdPath = path.join(scenarioRoot, 'run-id');

await mkdir(scenarioRoot, { recursive: true });

const ProbeNode = defineDagNode({
  nodeType: 'dag-001-probe',
  inputs: [{ key: 'previous', type: 'boolean', required: false }],
  outputs: [{ key: 'done', type: 'boolean', required: true }],
  configSchema: z.object({ phase: z.enum(['first', 'second']) }),
  execute: async (_inputs, config) => {
    if (config.phase === 'first' && mode === 'start') {
      await writeFile(startedPath, `${new Date().toISOString()}\n`, 'utf8');
      process.stdout.write(`${JSON.stringify({ phase: 'first-node-running' })}\n`);
      await new Promise((resolve) => setTimeout(resolve, 60_000));
    }
    return { done: true };
  },
});

const definition: IDagDefinition = {
  dagId: 'dag-001-crash-recovery',
  version: 1,
  status: 'published',
  nodes: [
    {
      nodeId: 'first',
      nodeType: 'dag-001-probe',
      dependsOn: [],
      config: { phase: 'first' },
      inputs: [],
      outputs: [{ key: 'done', type: 'boolean', required: true }],
    },
    {
      nodeId: 'second',
      nodeType: 'dag-001-probe',
      dependsOn: ['first'],
      config: { phase: 'second' },
      inputs: [{ key: 'previous', type: 'boolean', required: false }],
      outputs: [{ key: 'done', type: 'boolean', required: true }],
    },
  ],
  edges: [
    {
      from: 'first',
      to: 'second',
      bindings: [{ outputKey: 'done', inputKey: 'previous' }],
    },
  ],
};

const framework = await createDagFramework({
  nodes: [new ProbeNode()],
  paths: { storageRoot, assetRoot },
  worker: {
    workerId: `dag-001-${mode}`,
    leaseDurationMs: 100,
    visibilityTimeoutMs: 100,
    defaultTimeoutMs: 10_000,
    maxAttempts: 3,
    retryEnabled: true,
  },
  autoStart: true,
});

if (mode === 'start') {
  const created = await framework.client.createRun({ definition, input: {} });
  if (!created.ok) throw new Error(`createRun failed: ${JSON.stringify(created.payload)}`);
  const createdData = created.payload['data'] as { preparationId?: unknown } | undefined;
  if (typeof createdData?.preparationId !== 'string') {
    throw new Error(`createRun returned no preparationId: ${JSON.stringify(created.payload)}`);
  }
  const started = await framework.client.startRun(createdData.preparationId);
  if (!started.ok) throw new Error(`startRun failed: ${JSON.stringify(started.payload)}`);
  await writeFile(runIdPath, `${createdData.preparationId}\n`, 'utf8');
  process.stdout.write(
    `${JSON.stringify({ phase: 'run-started', dagRunId: createdData.preparationId })}\n`,
  );
  await new Promise((resolve) => setTimeout(resolve, 60_000));
} else {
  const dagRunId = (await readFile(runIdPath, 'utf8')).trim();
  // Start polling immediately. Recovery is intentionally unavailable until the persisted ownership
  // lease expires; its horizon includes the task timeout plus the worker's safety margin and is not
  // equal to leaseDurationMs. Keep this bounded while allowing that recorded horizon to pass.
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const response = await framework.client.getRunStatus(dagRunId);
    if (!response.ok) throw new Error(`getRunStatus failed: ${JSON.stringify(response.payload)}`);
    const data = response.payload['data'] as
      | { dagRun?: { status?: unknown; endedAt?: unknown }; taskRuns?: ITaskRun[] }
      | undefined;
    const first = data?.taskRuns?.find((task) => task.nodeId === 'first');
    const second = data?.taskRuns?.find((task) => task.nodeId === 'second');
    if (data?.dagRun?.status === 'success' && first?.status === 'success' && second?.status === 'success') {
      const restoredSecondInput =
        typeof second.inputSnapshot === 'string' ? JSON.parse(second.inputSnapshot) : undefined;
      if (first.attempt !== 2) {
        throw new Error(`first node attempt mismatch: expected 2, received ${first.attempt}`);
      }
      if (second.attempt !== 1) {
        throw new Error(`second node attempt mismatch: expected 1, received ${second.attempt}`);
      }
      if (
        typeof restoredSecondInput !== 'object' ||
        restoredSecondInput === null ||
        (restoredSecondInput as { previous?: unknown }).previous !== true
      ) {
        throw new Error(`second node input was not restored: ${JSON.stringify(restoredSecondInput)}`);
      }
      if (typeof data.dagRun.endedAt !== 'string') {
        throw new Error(`terminal run has no endedAt: ${JSON.stringify(data.dagRun)}`);
      }
      process.stdout.write(
        `${JSON.stringify({
          phase: 'recovered',
          dagRunId,
          runStatus: data.dagRun.status,
          attempts: { first: first.attempt, second: second.attempt },
          restoredSecondInput,
          endedAt: data.dagRun.endedAt,
        })}\n`,
      );
      await framework.stop();
      process.exit(0);
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  const finalStatus = await framework.client.getRunStatus(dagRunId);
  throw new Error(`run did not recover: ${JSON.stringify(finalStatus.payload)}`);
}
TYPESCRIPT

pnpm --dir scratch run run -- src/dag-001-crash-recovery-agent-run.ts start "$scenario_root" \
  >"$scenario_root/start.log" 2>&1 &
start_pid=$!

for _ in $(seq 1 200); do
  if [[ -f "$scenario_root/first-node-started" && -s "$scenario_root/run-id" ]]; then
    break
  fi
  if ! kill -0 "$start_pid" 2>/dev/null; then
    cat "$scenario_root/start.log"
    exit 1
  fi
  sleep 0.05
done

test -f "$scenario_root/first-node-started"
test -s "$scenario_root/run-id"
kill -KILL "$start_pid"
wait "$start_pid" 2>/dev/null || true
start_pid=""
printf '%s\n' '{"phase":"first-process-killed-after-node-started"}'

# Start the replacement immediately. Its public status polling remains live while the auto-started
# worker waits for the persisted ownership lease to expire and then performs the idle sweep.
pnpm --dir scratch run run -- src/dag-001-crash-recovery-agent-run.ts resume "$scenario_root" \
  | tee "$scenario_root/resume.log"

grep -F '"phase":"recovered"' "$scenario_root/resume.log"
grep -F '"runStatus":"success"' "$scenario_root/resume.log"
grep -F '"attempts":{"first":2,"second":1}' "$scenario_root/resume.log"
grep -F '"restoredSecondInput":{"previous":true}' "$scenario_root/resume.log"
```

## Expected observable result

- The Bash block exits with status `0`.
- Before restart it prints `{"phase":"first-process-killed-after-node-started"}`, proving the first
  process was killed only after the first node entered execution and the run id was persisted.
- The replacement process starts immediately after the kill and may remain `running` until the
  persisted ownership lease expires. It polls the public status for at most 60 seconds; it does not
  assume that the configured `leaseDurationMs: 100` is the ownership expiry time.
- The replacement process prints one JSON object containing all of these fields:
  - `"phase":"recovered"`
  - `"runStatus":"success"`
  - `"attempts":{"first":2,"second":1}` — the abandoned first node was reclaimed exactly once and
    the dependent second node ran once.
  - `"restoredSecondInput":{"previous":true}` — the edge-bound output from the recovered first node
    reached the second node after restart rather than being replaced with an empty payload.
  - a non-empty ISO `endedAt` value, proving the run reached a terminal state.
- Any missing terminal state, wrong attempt count, or lost input causes the fixture or a final `grep`
  to exit non-zero.

## Cleanup

The `EXIT` trap terminates any surviving first process, removes the command-materialized script, and
removes only the `mktemp` directory whose path matches `/tmp/robota-dag001.*`.

## Observed evidence

Executed by the agent on 2026-08-12 from the repository root after DONE-GATE-STAGE-1 passed.

- Exit code: `0`
- First-process observable:

  ```text
  {"phase":"first-process-killed-after-node-started"}
  ```

- Replacement-process observable (also matched by every final `grep` assertion):

  ```json
  {
    "phase": "recovered",
    "dagRunId": "dag-001-crash-recovery:run:1786541780529",
    "runStatus": "success",
    "attempts": { "first": 2, "second": 1 },
    "restoredSecondInput": { "previous": true },
    "endedAt": "2026-08-12T13:37:01.596Z"
  }
  ```

- Cleanup: the `EXIT` trap removed the command-materialized script and the bounded
  `/tmp/robota-dag001.AMOCgc` scenario root.
