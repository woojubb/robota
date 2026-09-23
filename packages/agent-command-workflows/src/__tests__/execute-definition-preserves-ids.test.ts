import { mkdtempSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { DEFAULT_WORKSPACE_LAYOUT } from '@robota-sdk/dag-core';
import { afterEach, describe, expect, it } from 'vitest';

import { executeDefinition } from '../authoring/execute-workflow.js';

import type { IDagDefinition, IDagNodeDefinition } from '@robota-sdk/dag-core';

/**
 * DAG-002, measured on the real production path.
 *
 * `executeDefinition` is what `/workflows create` and `/workflows run` both call. It held a canonical
 * `IDagDefinition`, converted it DOWN to the absorbed workflow-file format because that was the
 * provider's parameter type, and the provider immediately converted it back UP. Neither direction is
 * information-preserving, so the definition the runtime executed was not the one the caller authored:
 * string node ids became `node-<n>` and named ports became `out<i>`/`in<i>`.
 *
 * Run outputs are keyed `<nodeId>.<port>`, so a user reading a run record saw fabricated names for
 * nodes they had themselves named. This case asserts the observable directly, on the path a user
 * actually reaches — against the defect it reports `node-1.passage` and `node-2.passage`.
 */
const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function echoNode(): IDagNodeDefinition {
  return {
    nodeType: 'test/echo',
    displayName: 'Echo',
    category: 'test',
    inputs: [{ key: 'passage', type: 'string', required: false }],
    outputs: [{ key: 'passage', type: 'string', required: true }],
    // `null` means "no config schema, accept any config" — the node needs no zod dependency here.
    configSchemaDefinition: null,
    defaultInputPort: 'passage',
    defaultOutputPort: 'passage',
    taskHandler: {
      execute: async (input, context) => {
        const upstream = input['passage'];
        const own = (context.nodeDefinition.config as { text?: string }).text ?? '';
        return {
          ok: true,
          value: { passage: upstream === undefined ? own : `${String(upstream)}>${own}` },
        };
      },
    },
  };
}

function authoredDefinition(): IDagDefinition {
  return {
    dagId: 'authored',
    version: 1,
    status: 'draft',
    nodes: [
      { nodeId: 'greeting', nodeType: 'test/echo', dependsOn: [], config: { text: 'hello' } },
      {
        nodeId: 'reply',
        nodeType: 'test/echo',
        dependsOn: ['greeting'],
        config: { text: 'world' },
      },
    ],
    edges: [
      { from: 'greeting', to: 'reply', bindings: [{ outputKey: 'passage', inputKey: 'passage' }] },
    ],
  };
}

describe('executeDefinition runs the definition it was given (DAG-002)', () => {
  it('the run names the node ids the author wrote', async () => {
    const cwd = realpathSync(mkdtempSync(path.join(tmpdir(), 'exec-definition-')));
    tempDirs.push(cwd);

    const outcome = await executeDefinition(
      authoredDefinition(),
      cwd,
      DEFAULT_WORKSPACE_LAYOUT,
      [echoNode()],
      {},
    );

    expect(outcome.error).toBeUndefined();
    expect(outcome.ok).toBe(true);
    // Against the defect: ['node-1.passage', 'node-2.passage'].
    expect(Object.keys(outcome.outputs).sort()).toEqual(['greeting.passage', 'reply.passage']);
  });
});
