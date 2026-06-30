import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { toDagWorkflowFile } from '@robota-sdk/dag-builder';
import { createDagFramework, HttpDagRuntimeProvider } from '@robota-sdk/dag-framework';

import { createDagRuntimeServer } from '../app.js';

import type { IDagDefinition, IDagWorkflowFile } from '@robota-sdk/dag-core';
import type { IDagFramework } from '@robota-sdk/dag-framework';

// A single-node DAG: one InputNode emitting its configured text on the `text` output port.
// InputNode has no inputs and always succeeds, so the run reaches a terminal state quickly —
// exactly the race (run finishes before the watcher subscribes) the provider must tolerate.
const SINGLE_INPUT_DEFINITION: IDagDefinition = {
  dagId: 'http-roundtrip',
  version: 1,
  status: 'published',
  nodes: [{ nodeId: 'in', nodeType: 'input', dependsOn: [], config: { text: 'hello-http' } }],
  edges: [],
};

function buildWorkflowFile(): IDagWorkflowFile {
  return toDagWorkflowFile(SINGLE_INPUT_DEFINITION).workflowFile;
}

describe('HttpDagRuntimeProvider round-trip against the in-process server', () => {
  let framework: IDagFramework;
  let provider: HttpDagRuntimeProvider;

  beforeEach(async () => {
    framework = await createDagFramework();
    await framework.start();
    const app = createDagRuntimeServer(
      framework.client,
      framework.internals.execution.runProgressEventBus,
    );
    // Route the provider's HTTP + SSE traffic into the in-process Hono app instead of a real socket.
    const fetchImpl = ((input: RequestInfo | URL, init?: RequestInit) =>
      app.request(input as string, init)) as typeof fetch;
    provider = new HttpDagRuntimeProvider({ baseUrl: 'http://dag.test', fetch: fetchImpl });
  });

  afterEach(async () => {
    await framework.stop();
  });

  it('lists the node catalog over the native route', async () => {
    const nodes = await provider.listNodes();
    expect(Array.isArray(nodes)).toBe(true);
    expect(nodes.some((n) => n.nodeType === 'input')).toBe(true);
  });

  it('executes a DAG end-to-end (submit → watch → result)', async () => {
    const events: string[] = [];
    const result = await provider.execute(
      buildWorkflowFile(),
      { text: 'hello-http' },
      { onProgress: (e) => events.push(e.type) },
    );

    expect(result.ok).toBe(true);
    expect(result.error).toBeUndefined();
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    // The InputNode's `text` output (the run input, runtime-priority) reached the mapped result —
    // proof the payload flowed submit → execute → result over HTTP. The output key embeds the
    // recovered node id, so assert on the value rather than a brittle exact key.
    const textOutputs = Object.entries(result.outputs)
      .filter(([key]) => key.endsWith('.text'))
      .map(([, value]) => value);
    expect(textOutputs).toContain('hello-http');
  });

  it('submitRun returns a runId whose status becomes terminal', async () => {
    const runId = await provider.submitRun(buildWorkflowFile(), { text: 'status-check' });
    expect(typeof runId).toBe('string');
    expect(runId.length).toBeGreaterThan(0);

    // Watch to completion, then the status must be a terminal `completed`.
    await provider.watchRun(runId, () => undefined);
    const status = await provider.getRunStatus(runId);
    expect(status.runId).toBe(runId);
    expect(status.phase).toBe('completed');
    expect(status.result?.ok).toBe(true);
  });

  it('rejects unsupported detachable operations rather than faking success', async () => {
    await expect(provider.cancelRun('run-x')).rejects.toThrow(/not supported/);
    await expect(provider.listRuns()).rejects.toThrow(/not supported/);
  });
});
