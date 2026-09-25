import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
// Imported from the built entry point, not a relative TS source import: the isolated regex
// worker's bootstrap script is built from `Function.prototype.toString()`, and a dev-time
// TS transform (as `tsx` applies to a live source import) can rewrite that source and break
// it. Running against the built package matches how every real host consumes this code, and
// this plain-JS fixture runs under plain `node` (no transform in the loader at all).
const dagFrameworkDist = fileURLToPath(
  new URL('../../../dist/node/index.js', import.meta.url),
);

// Runs createDagFramework's own default composition (not LocalDagRuntimeProvider) against a
// catastrophic-backtracking pattern to prove the host process stays responsive and the run
// fails closed within its node timeout. Runs out-of-process so a regression that blocks the
// event loop kills this child (via the parent's watchdog) instead of hanging the test runner.
const { createDagFramework } = await import(dagFrameworkDist);

const root = mkdtempSync(join(tmpdir(), 'dag-framework-regex-watchdog-'));

async function pollRunStatus(framework, dagRunId, timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const res = await framework.runs.getRun(dagRunId);
    if (!res.ok) return 'error';
    if (res.value.dagRun.status === 'success' || res.value.dagRun.status === 'failed') {
      return res.value.dagRun.status;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  return 'timeout';
}

let heartbeats = 0;
const heartbeat = setInterval(() => {
  heartbeats++;
}, 10);

const framework = await createDagFramework({
  paths: { storageRoot: join(root, 'storage'), assetRoot: join(root, 'assets') },
  autoStart: true,
});

try {
  const definition = {
    dagId: 'regex-watchdog',
    version: 1,
    status: 'draft',
    nodes: [
      {
        nodeId: 'input',
        nodeType: 'input',
        dependsOn: [],
        config: { text: 'a'.repeat(40) + '!' },
      },
      {
        nodeId: 'regex',
        nodeType: 'text-replace',
        dependsOn: ['input'],
        timeoutMs: 300,
        config: { search: '^(a+)+$', flags: '', useRegex: true, replacement: 'done' },
      },
      { nodeId: 'after', nodeType: 'text-output', dependsOn: ['regex'], config: {} },
    ],
    edges: [
      { from: 'input', to: 'regex', bindings: [{ outputKey: 'text', inputKey: 'text' }] },
      { from: 'regex', to: 'after', bindings: [{ outputKey: 'text', inputKey: 'text' }] },
    ],
  };

  process.stdout.write('entered\n');
  const runRes = await framework.runs.createRun({ definition });
  if (!runRes.ok) throw new Error('createRun failed');
  const { dagRunId } = runRes.value;
  await framework.runs.startRun(dagRunId);
  const status = await pollRunStatus(framework, dagRunId, 4000);
  const result = await framework.runs.getRun(dagRunId);
  const regexTaskRun = result.ok
    ? result.value.taskRuns.find((t) => t.nodeId === 'regex')
    : undefined;
  clearInterval(heartbeat);
  process.stdout.write(
    JSON.stringify({
      status,
      heartbeats,
      errorCode: regexTaskRun?.errorCode ?? null,
      errorMessage: regexTaskRun?.errorMessage ?? null,
    }) + '\n',
  );
} finally {
  await framework.stop();
  rmSync(root, { recursive: true, force: true });
}
