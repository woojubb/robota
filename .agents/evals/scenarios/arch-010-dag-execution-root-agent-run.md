# ARCH-010 — trusted DAG execution-root containment (agent-run)

This scenario drives the public `createDagFramework` surface with the provider-free default `tool`
node. A temporary project is the trusted execution root; a sibling directory holds a unique sentinel
that must never be disclosed. The same framework run proves denial of an absolute outside read,
denial of three attacker-authored `config.cwd` widening forms, and successful narrowing to an internal
subdirectory.

## Executability

`agent-executable` — the flow is non-interactive Bash, uses only local temporary files and the public
DAG framework API, and needs no model-provider credentials or external service.

## Prerequisites

- Run from the repository root with workspace dependencies installed.
- Bash, Node.js, pnpm, and permission to create a local filesystem symlink must be available.
- `scratch/src/` must be writable; the command materializes its disposable public-SDK fixture there.
- No network access or provider key is required.

## Exact command

```bash
set -euo pipefail

scenario_root="$(mktemp -d /tmp/robota-arch010.XXXXXX)"
scenario_script="scratch/src/arch-010-dag-execution-root-agent-run.ts"

cleanup() {
  rm -f -- "$scenario_script"
  case "$scenario_root" in
    /tmp/robota-arch010.*) rm -rf -- "$scenario_root" ;;
    *) printf 'refusing unexpected cleanup path: %s\n' "$scenario_root" >&2; return 1 ;;
  esac
}
trap cleanup EXIT

mkdir -p "$(dirname "$scenario_script")"
tee "$scenario_script" >/dev/null <<'TYPESCRIPT'
import assert from 'node:assert/strict';
import { mkdir, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

import type { IDagDefinition, ITaskRun } from '../../packages/dag-core/src/index.ts';
import { createDagFramework } from '../../packages/dag-framework/src/index.ts';
import { createDefaultNodeRegistrySync } from '../../packages/dag-nodes-default/src/index.ts';

const rootArg = process.argv[2];
if (rootArg === undefined) {
  throw new Error('usage: arch-010-dag-execution-root-agent-run.ts <scenario-root>');
}

const scenarioRoot = path.resolve(rootArg);
const projectRoot = path.join(scenarioRoot, 'project');
const insideRoot = path.join(projectRoot, 'inside');
const outsideRoot = path.join(scenarioRoot, 'outside');
const outsideFile = path.join(outsideRoot, 'secret.txt');
const insideFile = path.join(insideRoot, 'allowed.txt');
const escapeLink = path.join(projectRoot, 'escape-link');
const sentinel = `ARCH010_OUTSIDE_SECRET_${process.pid}`;
const allowed = `ARCH010_INSIDE_OK_${process.pid}`;

await mkdir(insideRoot, { recursive: true });
await mkdir(outsideRoot, { recursive: true });
await writeFile(outsideFile, `${sentinel}\n`, 'utf8');
await writeFile(insideFile, `${allowed}\n`, 'utf8');
await symlink(outsideRoot, escapeLink, 'dir');

const framework = await createDagFramework({
  executionRoot: projectRoot,
  nodes: createDefaultNodeRegistrySync(),
  paths: {
    storageRoot: path.join(scenarioRoot, 'storage'),
    assetRoot: path.join(scenarioRoot, 'assets'),
  },
  worker: {
    workerId: 'arch-010-agent-run',
    leaseDurationMs: 1_000,
    visibilityTimeoutMs: 1_000,
    defaultTimeoutMs: 5_000,
    maxAttempts: 1,
    retryEnabled: false,
  },
  autoStart: true,
});

interface ICaseResult {
  readonly runStatus: unknown;
  readonly task: ITaskRun;
}

async function runToolCase(
  caseId: string,
  config: Record<string, unknown>,
): Promise<ICaseResult> {
  const definition: IDagDefinition = {
    dagId: `arch-010-${caseId}`,
    version: 1,
    status: 'published',
    nodes: [{ nodeId: 'probe', nodeType: 'tool', dependsOn: [], config }],
    edges: [],
  };
  const created = await framework.client.createRun({ definition, input: {} });
  assert.equal(created.ok, true, `${caseId}: createRun failed: ${JSON.stringify(created.payload)}`);
  const data = created.payload['data'] as { preparationId?: unknown } | undefined;
  assert.equal(typeof data?.preparationId, 'string', `${caseId}: no preparation id`);
  const dagRunId = data?.preparationId as string;
  const started = await framework.client.startRun(dagRunId);
  assert.equal(started.ok, true, `${caseId}: startRun failed: ${JSON.stringify(started.payload)}`);

  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const response = await framework.client.getRunStatus(dagRunId);
    assert.equal(response.ok, true, `${caseId}: getRunStatus failed`);
    const statusData = response.payload['data'] as
      | { dagRun?: { status?: unknown }; taskRuns?: ITaskRun[] }
      | undefined;
    if (statusData?.dagRun?.status === 'success' || statusData?.dagRun?.status === 'failed') {
      assert.equal(statusData.taskRuns?.length, 1, `${caseId}: expected one task`);
      return { runStatus: statusData.dagRun.status, task: statusData.taskRuns?.[0] as ITaskRun };
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`${caseId}: run did not reach a terminal state`);
}

function serialized(result: ICaseResult): string {
  return JSON.stringify(result);
}

function assertOutsideContentHidden(caseId: string, result: ICaseResult): void {
  assert.equal(serialized(result).includes(sentinel), false, `${caseId}: outside content leaked`);
}

function assertCwdWideningRejected(caseId: string, result: ICaseResult): void {
  assert.equal(result.runStatus, 'failed', `${caseId}: widening did not fail the run`);
  assert.equal(result.task.status, 'failed', `${caseId}: widening did not fail the task`);
  assert.equal(result.task.errorCode, 'DAG_VALIDATION_TOOL_CWD_OUTSIDE_ROOT');
  assertOutsideContentHidden(caseId, result);
}

try {
  const outsideRead = await runToolCase('absolute-outside-read', {
    toolName: 'read',
    params: { filePath: outsideFile },
  });
  const outsideOutput = outsideRead.task.outputSnapshot ?? '';
  assert.equal(outsideRead.runStatus, 'success');
  assert.match(outsideOutput, /Access denied|outside (?:the )?(?:working directory|execution root)/i);
  assertOutsideContentHidden('absolute-outside-read', outsideRead);

  const absoluteCwd = await runToolCase('absolute-cwd-widening', {
    toolName: 'read',
    cwd: outsideRoot,
    params: { filePath: outsideFile },
  });
  assertCwdWideningRejected('absolute-cwd-widening', absoluteCwd);

  const traversalCwd = await runToolCase('parent-cwd-widening', {
    toolName: 'read',
    cwd: '../outside',
    params: { filePath: outsideFile },
  });
  assertCwdWideningRejected('parent-cwd-widening', traversalCwd);

  const symlinkCwd = await runToolCase('symlink-cwd-widening', {
    toolName: 'read',
    cwd: 'escape-link',
    params: { filePath: path.join(escapeLink, 'secret.txt') },
  });
  assertCwdWideningRejected('symlink-cwd-widening', symlinkCwd);

  const narrowed = await runToolCase('internal-cwd-narrowing', {
    toolName: 'read',
    cwd: 'inside',
    params: { filePath: insideFile },
  });
  assert.equal(narrowed.runStatus, 'success');
  assert.equal(narrowed.task.status, 'success');
  assert.match(narrowed.task.outputSnapshot ?? '', new RegExp(allowed));
  assertOutsideContentHidden('internal-cwd-narrowing', narrowed);

  process.stdout.write(
    `${JSON.stringify({
      phase: 'arch-010-contained',
      executionRoot: projectRoot,
      absoluteOutsideRead: 'denied-without-content',
      cwdWidening: { absolute: 'denied', parent: 'denied', symlink: 'denied' },
      internalNarrowing: 'success',
      outsideSentinelDisclosed: false,
    })}\n`,
  );
} finally {
  await framework.stop();
}
TYPESCRIPT

pnpm --dir scratch run run -- src/arch-010-dag-execution-root-agent-run.ts "$scenario_root" \
  | tee "$scenario_root/result.log"

grep -F '"phase":"arch-010-contained"' "$scenario_root/result.log"
grep -F '"absoluteOutsideRead":"denied-without-content"' "$scenario_root/result.log"
grep -F '"cwdWidening":{"absolute":"denied","parent":"denied","symlink":"denied"}' \
  "$scenario_root/result.log"
grep -F '"internalNarrowing":"success"' "$scenario_root/result.log"
grep -F '"outsideSentinelDisclosed":false' "$scenario_root/result.log"
if grep -F 'ARCH010_OUTSIDE_SECRET_' "$scenario_root/result.log"; then
  printf '%s\n' 'outside sentinel appeared in product output' >&2
  exit 1
fi
```

## Expected observable result

- The Bash block exits with status `0`.
- It prints one JSON object containing:
  - `"phase":"arch-010-contained"`
  - `"absoluteOutsideRead":"denied-without-content"`
  - `"cwdWidening":{"absolute":"denied","parent":"denied","symlink":"denied"}`
  - `"internalNarrowing":"success"`
  - `"outsideSentinelDisclosed":false`
- The absolute sibling-file read is refused by the filesystem tool with a containment error, and the
  dynamically generated `ARCH010_OUTSIDE_SECRET_*` content appears nowhere in the observed product
  output or persisted task result.
- Absolute, `..`, and escaping-symlink values supplied through authored `config.cwd` each fail their
  DAG run with `DAG_VALIDATION_TOOL_CWD_OUTSIDE_ROOT`.
- `config.cwd: "inside"` narrows within the trusted root and the allowed file content is returned.

## Cleanup

The `EXIT` trap removes the command-materialized script and only the `mktemp` directory whose path
matches `/tmp/robota-arch010.*`, including its project, outside sentinel, symlink, and DAG state.

## Observed evidence

Executed by the agent on 2026-08-12 against the completed, rebuilt implementation.

- Exact Bash block exit code: `0`.
- Captured product output:

```text
{"phase":"arch-010-contained","executionRoot":"/tmp/robota-arch010.a3bdPo/project","absoluteOutsideRead":"denied-without-content","cwdWidening":{"absolute":"denied","parent":"denied","symlink":"denied"},"internalNarrowing":"success","outsideSentinelDisclosed":false}
```

- Every exact `grep -F` assertion matched and the dynamically generated outside sentinel was absent
  from product output.
- Cleanup verification passed: both `scratch/src/arch-010-dag-execution-root-agent-run.ts` and the
  bounded `/tmp/robota-arch010.a3bdPo` fixture root were absent after the `EXIT` trap.
- A pre-build attempt correctly failed the symlink-widening assertion because the public package
  surface still resolved stale `dist` output. After rebuilding every affected package, the unchanged
  scenario passed. No expected observable was rewritten to fit the failed attempt.
- Final checkpoint rerun after review fixes: exit code `0`, with execution root
  `/tmp/robota-arch010.GMsX0N/project`; every exact assertion matched, the outside sentinel remained
  absent, and the bounded cleanup trap removed the fixture and materialized script.
