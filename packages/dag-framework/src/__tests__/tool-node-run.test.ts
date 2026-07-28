import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildDagFromPipeline, toDagWorkflowFile } from '@robota-sdk/dag-builder';
import type { INodeManifest } from '@robota-sdk/dag-core';
import { LocalDagRuntimeProvider } from '../local-dag-runtime-provider.js';
import { createDefaultNodeRegistrySync } from '@robota-sdk/dag-nodes-default';

function syncManifests(): INodeManifest[] {
  return createDefaultNodeRegistrySync().map((d) => ({
    nodeType: d.nodeType,
    displayName: d.displayName,
    category: d.category,
    inputs: d.inputs,
    outputs: d.outputs,
    ...(d.defaultInputPort !== undefined ? { defaultInputPort: d.defaultInputPort } : {}),
    ...(d.defaultOutputPort !== undefined ? { defaultOutputPort: d.defaultOutputPort } : {}),
  }));
}

describe('tool node — functional run through LocalDagRuntimeProvider', () => {
  let dir: string;
  let file: string;

  beforeAll(() => {
    // Inside the invocation directory, not `os.tmpdir()`. SEC-007 roots the tool node's file
    // containment at the directory the run was invoked from, and `config.cwd` may only NARROW that
    // root — so a fixture under `/tmp` is outside it and the node correctly answers "Access denied".
    // A DAG reading a path outside its invocation root is the thing that containment removed; this
    // test is about a tool node reading a file at all, so it owns a directory inside the root.
    dir = mkdtempSync(join(process.cwd(), '.tmp-dag-tool-run-'));
    file = join(dir, 'hello.txt');
    writeFileSync(file, 'alpha\nbeta\ngamma\n', 'utf8');
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('runs a 1-node `tool` workflow that reads a file end-to-end', async () => {
    const provider = new LocalDagRuntimeProvider();

    const build = buildDagFromPipeline(
      {
        dagId: 'tool-run',
        pipeline: [
          {
            nodeType: 'tool',
            id: 'read-1',
            config: { toolName: 'read', params: { filePath: file } },
          },
        ],
      },
      syncManifests(),
    );
    expect(build.ok).toBe(true);
    if (!build.ok) return;

    const { workflowFile } = toDagWorkflowFile(build.definition);
    const result = await provider.execute(workflowFile, {});

    expect(result.ok).toBe(true);
    const serialized = JSON.stringify(result.outputs);
    expect(serialized).toContain('alpha');
    expect(serialized).toContain('gamma');
  });
});
