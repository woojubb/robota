/**
 * WORKFLOW-004 — `/workflows build`: author → validate → save, NEVER execute.
 *
 * The non-execution contract is proven mechanically: `LocalDagRuntimeProvider.prototype.execute`
 * (the only in-process DAG execution entry, used by `create`/`run` via
 * `authoring/execute-workflow.ts`) is spied in every test and asserted at 0 calls.
 */
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { createAssistantMessage } from '@robota-sdk/agent-core';
import type { IAIProvider } from '@robota-sdk/agent-core';
import { LocalDagRuntimeProvider } from '@robota-sdk/dag-framework';

import { executeWorkflowsBuild } from '../build-command.js';
import type { IWorkflowsCreateDeps } from '../create-command.js';
import { executeWorkflowsRun } from '../run-command.js';
import { executeWorkflowsValidate } from '../validate-command.js';

/** A provider stub whose `chat` always returns the given JSON string as assistant content. */
function stubProvider(specJson: string): IAIProvider {
  return {
    chat: async () => createAssistantMessage(specJson),
  } as unknown as IAIProvider;
}

const UPPERCASE_SPEC = JSON.stringify({
  name: 'uppercase-it',
  description: 'uppercase the input',
  pipeline: [{ nodeType: 'input' }, { nodeType: 'text-upper' }, { nodeType: 'text-output' }],
  sampleInput: { text: 'hello world' },
});

let dir: string;
/** TC-01 canary: the DAG runtime execute path — MUST stay at 0 calls across every `build`. */
let executeCanary: MockInstance<typeof LocalDagRuntimeProvider.prototype.execute>;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'wf-build-'));
  executeCanary = vi.spyOn(LocalDagRuntimeProvider.prototype, 'execute');
});
afterEach(async () => {
  executeCanary.mockRestore();
  await rm(dir, { recursive: true, force: true });
});

function baseDeps(specJson: string): IWorkflowsCreateDeps {
  return {
    resolveProvider: () => stubProvider(specJson),
    now: () => '2026-07-25T00:00:00.000Z',
  };
}

describe('executeWorkflowsBuild (TC-01: author + save, never execute)', () => {
  it('saves .workflows/<name>.json, reports the path + next steps, and produces NO run output', async () => {
    const result = await executeWorkflowsBuild(
      '"uppercase the text" --input text=hi',
      dir,
      baseDeps(UPPERCASE_SPEC),
    );
    expect(result.success).toBe(true);

    const savedPath = join(dir, '.workflows', 'uppercase-it.json');
    await expect(stat(savedPath)).resolves.toBeDefined();
    expect(result.message).toContain(savedPath);

    // Explicit next steps — build hands off to the existing subcommands.
    expect(result.message).toContain(`/workflows validate ${savedPath}`);
    expect(result.message).toContain(`/workflows run ${savedPath}`);

    // NO run output: nothing executed, so no outputs/duration lines can exist.
    expect(result.message).not.toContain('Outputs:');
    expect(result.message).not.toMatch(/Completed in \d+ms/);
    expect(result.message).not.toContain('HI'); // the would-be run result never appears

    // Mechanical non-execution proof: the runtime execute path was never invoked.
    expect(executeCanary).toHaveBeenCalledTimes(0);
  });

  it('bakes the explicit --input into the artifact input node (self-contained)', async () => {
    await executeWorkflowsBuild('"uppercase" --input text=hi', dir, baseDeps(UPPERCASE_SPEC));
    const saved = JSON.parse(
      await readFile(join(dir, '.workflows', 'uppercase-it.json'), 'utf-8'),
    ) as { nodes: Array<{ nodeType: string; config: Record<string, unknown> }> };
    const inputNode = saved.nodes.find((n) => n.nodeType === 'input');
    expect(inputNode?.config).toMatchObject({ text: 'hi' });
    expect(executeCanary).toHaveBeenCalledTimes(0);
  });
});

describe('build → validate → run round-trip (TC-02)', () => {
  it('the built artifact validates cleanly and runs with the baked input', async () => {
    const built = await executeWorkflowsBuild(
      '"uppercase the text" --input text=hi',
      dir,
      baseDeps(UPPERCASE_SPEC),
    );
    expect(built.success).toBe(true);
    const savedPath = join(dir, '.workflows', 'uppercase-it.json');

    // build itself executed nothing…
    expect(executeCanary).toHaveBeenCalledTimes(0);

    const validated = await executeWorkflowsValidate(savedPath, dir);
    expect(validated.success).toBe(true);
    expect(validated.message).toContain('Valid workflow');

    // …and the explicit `run` step is the one that executes it.
    const run = await executeWorkflowsRun(savedPath, dir);
    expect(run.success).toBe(true);
    expect(run.message).toContain('HI');
    expect(executeCanary).toHaveBeenCalledTimes(1);
  });
});

describe('executeWorkflowsBuild (TC-03: invalid/unassemblable spec → nothing written)', () => {
  it('fails with the spec-validation error and writes no file for a non-JSON response', async () => {
    const result = await executeWorkflowsBuild('"whatever"', dir, baseDeps('not json at all'));
    expect(result.success).toBe(false);
    expect(result.message).toContain('invalid spec');
    await expect(stat(join(dir, '.workflows'))).rejects.toBeDefined();
    expect(executeCanary).toHaveBeenCalledTimes(0);
  });

  it('fails with the assembly error and writes no file for an unknown node type', async () => {
    const badPipeline = JSON.stringify({
      name: 'bad-pipe',
      pipeline: [{ nodeType: 'input' }, { nodeType: 'no-such-node' }, { nodeType: 'text-output' }],
    });
    const result = await executeWorkflowsBuild('"whatever"', dir, baseDeps(badPipeline));
    expect(result.success).toBe(false);
    expect(result.message).toContain('Could not assemble workflow');
    await expect(stat(join(dir, '.workflows'))).rejects.toBeDefined();
    expect(executeCanary).toHaveBeenCalledTimes(0);
  });
});

describe('executeWorkflowsBuild (TC-04: no active provider)', () => {
  // Deterministic "no settings, no key" environment regardless of the ambient env.
  beforeEach(() => {
    for (const key of [
      'ANTHROPIC_API_KEY',
      'OPENAI_API_KEY',
      'GEMINI_API_KEY',
      'DEEPSEEK_API_KEY',
      'DASHSCOPE_API_KEY',
    ]) {
      vi.stubEnv(key, '');
    }
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns an actionable error and writes nothing (no deps seam, no settings)', async () => {
    const result = await executeWorkflowsBuild('"uppercase the input"', dir, {});
    expect(result.success).toBe(false);
    expect(result.message).toContain('provider');
    await expect(stat(join(dir, '.workflows'))).rejects.toBeDefined();
    expect(executeCanary).toHaveBeenCalledTimes(0);
  });

  it('returns an actionable error when the injected resolver throws', async () => {
    const result = await executeWorkflowsBuild('"uppercase the input"', dir, {
      resolveProvider: () => {
        throw new Error('no currentProvider configured');
      },
    });
    expect(result.success).toBe(false);
    expect(result.message).toContain('provider');
    await expect(stat(join(dir, '.workflows'))).rejects.toBeDefined();
    expect(executeCanary).toHaveBeenCalledTimes(0);
  });
});

describe('executeWorkflowsBuild (TC-05: newNodes persisted inert)', () => {
  const PIRATE_SPEC = JSON.stringify({
    name: 'pirate-rewrite',
    pipeline: [{ nodeType: 'input' }, { nodeType: 'pirate-speak' }, { nodeType: 'text-output' }],
    newNodes: [
      {
        nodeType: 'pirate-speak',
        displayName: 'Pirate Speak',
        systemPromptTemplate: 'Rewrite as a pirate: {{text}}',
        inputPorts: [{ key: 'text' }],
        outputPort: { key: 'text' },
        provider: 'anthropic',
      },
    ],
    sampleInput: { text: 'hello' },
  });

  it('saves the prompt-node manifest under nodes/, the workflow references it, nothing executes', async () => {
    const result = await executeWorkflowsBuild('"rewrite as a pirate"', dir, baseDeps(PIRATE_SPEC));
    expect(result.success).toBe(true);

    // Inert manifest persisted (persisting executes nothing — key-using node never runs).
    const nodePath = join(dir, '.workflows', 'nodes', 'pirate-speak.node.json');
    const manifest = JSON.parse(await readFile(nodePath, 'utf-8')) as {
      kind: string;
      nodeType: string;
    };
    expect(manifest.kind).toBe('prompt');
    expect(manifest.nodeType).toBe('pirate-speak');
    expect(result.message).toContain('pirate-speak.node.json');

    // The saved workflow references the new node type.
    const saved = JSON.parse(
      await readFile(join(dir, '.workflows', 'pirate-rewrite.json'), 'utf-8'),
    ) as { nodes: Array<{ nodeType: string }> };
    expect(saved.nodes.some((n) => n.nodeType === 'pirate-speak')).toBe(true);

    // Unlike `create` (which would fail here on the missing key), build succeeds — it never ran.
    expect(result.message).not.toContain('run failed');
    expect(executeCanary).toHaveBeenCalledTimes(0);
  });
});
