import { mkdtempSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { DEFAULT_WORKSPACE_LAYOUT } from '@robota-sdk/dag-core';
import { afterEach, describe, expect, it } from 'vitest';

import { LocalDagRuntimeProvider } from '../local-dag-runtime-provider.js';

import type { IDagDefinition, IDagNodeDefinition } from '@robota-sdk/dag-core';

/**
 * DAG-002 — the execution contract was typed on an imported system's file format.
 *
 * `IDagRuntimeProvider.execute` took an `IDagWorkflowFile` — the absorbed ComfyUI-style
 * serialization, with `last_node_id`, numeric node ids, and `links` as six-element tuples. Every
 * production caller already held the canonical `IDagDefinition`, converted DOWN to that format, and
 * the provider immediately converted back UP. The conversion is not information-preserving in either
 * direction, so what came back was not what went in:
 *
 * - node ids were rewritten to `node-<n>` (`dag-workflow-converter.ts:207`), destroying string ids,
 * - port keys were INVENTED as `out<i>`/`in<i>` (`:253-254`) when a slot carried no name.
 *
 * Run outputs are keyed `<nodeId>.<port>` (`run-result-mapping.ts:35`), so the loss surfaced directly
 * in the result a caller reads. `instant-node-loader.ts` had to rebuild a `node-<n>` → original-id map
 * from a companion file produced purely to survive a round trip between two callers who both already
 * held the definition.
 *
 * These cases pin the observable, not the internals: a definition with meaningful string node ids and
 * named ports comes back naming those same ids and ports. Against the defect the keys are `node-1.…`
 * and `node-2.…`.
 */
const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function projectDir(): string {
  const dir = realpathSync(mkdtempSync(path.join(tmpdir(), 'dag-exec-contract-')));
  tempDirs.push(dir);
  return dir;
}

/** A node that needs no provider, no key and no network: it echoes its config into a named port. */
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

/**
 * Two nodes whose ids are words rather than numbers, joined on a port whose name is a word rather
 * than a slot index. Both are exactly what the round trip could not carry.
 */
function definitionWithStringIds(): IDagDefinition {
  return {
    dagId: 'string-ids',
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

describe('the execution contract carries the domain model (DAG-002)', () => {
  it('run outputs name the ORIGINAL string node ids', async () => {
    const root = projectDir();
    const provider = new LocalDagRuntimeProvider({
      executionRoot: root,
      workspace: DEFAULT_WORKSPACE_LAYOUT,
      projectDir: root,
      instantNodes: [echoNode()],
    });

    const result = await provider.execute(definitionWithStringIds(), {});

    expect(result.error).toBeUndefined();
    expect(result.ok).toBe(true);
    // Against the defect these read `node-1.passage` / `node-2.passage`.
    expect(Object.keys(result.outputs).sort()).toEqual(['greeting.passage', 'reply.passage']);
  });

  it('the named port survives, and the edge it carries is still wired', async () => {
    // A port key invented as `out0`/`in0` would not match the handler's declared `passage` port, so
    // the value would not arrive: the id loss and the wiring loss are the same defect seen twice.
    const root = projectDir();
    const provider = new LocalDagRuntimeProvider({
      executionRoot: root,
      workspace: DEFAULT_WORKSPACE_LAYOUT,
      projectDir: root,
      instantNodes: [echoNode()],
    });

    const result = await provider.execute(definitionWithStringIds(), {});

    expect(result.outputs['reply.passage']).toBe('hello>world');
  });
});
