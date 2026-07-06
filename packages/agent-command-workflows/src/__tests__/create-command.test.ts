import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAssistantMessage } from '@robota-sdk/agent-core';
import type { IAIProvider } from '@robota-sdk/agent-core';
import {
  executeWorkflowsCreate,
  parseCreateArgs,
  type IWorkflowsCreateDeps,
} from '../create-command.js';
import { parseAuthoredSpec } from '../authoring/spec.js';
import { executeWorkflowsRun } from '../run-command.js';

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

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'wf-create-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function baseDeps(specJson: string): IWorkflowsCreateDeps {
  return {
    resolveProvider: () => stubProvider(specJson),
    now: () => '2026-07-06T00:00:00.000Z',
  };
}

describe('parseCreateArgs', () => {
  it('takes a quoted description and repeatable --input', () => {
    const r = parseCreateArgs('"uppercase the text" --input text="hi there" --name foo');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.description).toBe('uppercase the text');
    expect(r.value.inputs).toEqual({ text: 'hi there' });
    expect(r.value.nameOverride).toBe('foo');
  });

  it('treats leading unquoted words as the description', () => {
    const r = parseCreateArgs('summarize my input then translate');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.description).toBe('summarize my input then translate');
  });

  it('errors on an empty description', () => {
    const r = parseCreateArgs('   ');
    expect(r.ok).toBe(false);
  });

  it('errors on a malformed --input', () => {
    const r = parseCreateArgs('desc --input nope');
    expect(r.ok).toBe(false);
  });
});

describe('parseAuthoredSpec', () => {
  it('accepts a valid spec', () => {
    const r = parseAuthoredSpec(UPPERCASE_SPEC);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.spec.name).toBe('uppercase-it');
    expect(r.spec.pipeline).toHaveLength(3);
  });

  it('rejects a non-JSON response', () => {
    const r = parseAuthoredSpec('not json at all');
    expect(r.ok).toBe(false);
  });

  it('tolerates a Markdown ```json code fence around the JSON (real LLM behavior)', () => {
    const r = parseAuthoredSpec('```json\n' + UPPERCASE_SPEC + '\n```');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.spec.name).toBe('uppercase-it');
  });

  it('rejects an invalid name', () => {
    const r = parseAuthoredSpec(
      JSON.stringify({ name: 'bad name!', pipeline: [{ nodeType: 'x' }] }),
    );
    expect(r.ok).toBe(false);
  });

  it('rejects an empty pipeline', () => {
    const r = parseAuthoredSpec(JSON.stringify({ name: 'ok', pipeline: [] }));
    expect(r.ok).toBe(false);
  });

  it('parses a newNodes prompt node', () => {
    const r = parseAuthoredSpec(
      JSON.stringify({
        name: 'piraten',
        pipeline: [{ nodeType: 'input' }, { nodeType: 'pirate' }, { nodeType: 'text-output' }],
        newNodes: [
          {
            nodeType: 'pirate',
            systemPromptTemplate: 'Rewrite as a pirate: {{text}}',
            inputPorts: [{ key: 'text' }],
            outputPort: { key: 'text' },
          },
        ],
      }),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.spec.newNodes).toHaveLength(1);
  });
});

describe('executeWorkflowsCreate (TC-02: author + save + run existing nodes)', () => {
  it('authors, saves .workflows/<name>.json, and runs it — output is uppercased', async () => {
    const result = await executeWorkflowsCreate(
      '"uppercase the input text"',
      dir,
      baseDeps(UPPERCASE_SPEC),
    );
    expect(result.success).toBe(true);

    const savedPath = join(dir, '.workflows', 'uppercase-it.json');
    await expect(stat(savedPath)).resolves.toBeDefined();

    const saved = JSON.parse(await readFile(savedPath, 'utf-8')) as {
      dagId: string;
      nodes: unknown[];
    };
    expect(saved.dagId).toBe('uppercase-it');
    expect(saved.nodes.length).toBe(3);

    expect(result.message).toContain('HELLO WORLD');
    expect(result.message).toContain('uppercase-it.json');
  });

  it('honors an explicit --input over the spec sampleInput', async () => {
    const result = await executeWorkflowsCreate(
      '"uppercase it" --input text="direct input"',
      dir,
      baseDeps(UPPERCASE_SPEC),
    );
    expect(result.success).toBe(true);
    expect(result.message).toContain('DIRECT INPUT');
  });
});

describe('executeWorkflowsRun (TC-03: the saved artifact is re-runnable)', () => {
  it('reproduces the result without re-authoring', async () => {
    await executeWorkflowsCreate('"uppercase"', dir, baseDeps(UPPERCASE_SPEC));
    const savedPath = join(dir, '.workflows', 'uppercase-it.json');

    const rerun = await executeWorkflowsRun(savedPath, dir);
    expect(rerun.success).toBe(true);
    // The sample input is baked into the artifact, so a bare re-run reproduces the same result.
    expect(rerun.message).toContain('HELLO WORLD');
  });
});

describe('executeWorkflowsCreate (TC-04: no active provider)', () => {
  it('returns an actionable error and writes nothing', async () => {
    const result = await executeWorkflowsCreate('"uppercase the input"', dir, {
      resolveProvider: () => {
        throw new Error('no currentProvider configured');
      },
    });
    expect(result.success).toBe(false);
    expect(result.message).toContain('provider');
    // Nothing was written.
    await expect(stat(join(dir, '.workflows'))).rejects.toBeDefined();
  });
});

describe('executeWorkflowsCreate (TC-05: on-the-fly prompt node)', () => {
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

  // This test executes a real key-using prompt node. To keep it deterministic and free of any
  // network call, force the no-key path by clearing every provider key — regardless of what is in
  // the ambient environment. The missing key MUST then surface as a detected error (asserted below),
  // never a silent pass and never a real LLM call.
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

  it('saves the prompt node + workflow, surfaces the missing-key error, and reuses the node', async () => {
    const first = await executeWorkflowsCreate('"rewrite as a pirate"', dir, baseDeps(PIRATE_SPEC));

    // Author-before-run: the node + workflow are persisted even though the run cannot complete.
    const nodePath = join(dir, '.workflows', 'nodes', 'pirate-speak.node.json');
    const nodeManifest = JSON.parse(await readFile(nodePath, 'utf-8')) as {
      kind: string;
      nodeType: string;
    };
    expect(nodeManifest.kind).toBe('prompt');
    expect(nodeManifest.nodeType).toBe('pirate-speak');
    await expect(stat(join(dir, '.workflows', 'pirate-rewrite.json'))).resolves.toBeDefined();
    expect(first.message).toContain('pirate-speak.node.json');

    // Key-using code ran without a key → the failure MUST be detected and surfaced, not swallowed.
    expect(first.success).toBe(false);
    expect(first.message).toMatch(/ANTHROPIC_API_KEY|api key|required|is not set/i);

    // Second create reuses the already-saved node (it is loaded and present in the catalog).
    const second = await executeWorkflowsCreate(
      '"rewrite as a pirate again"',
      dir,
      baseDeps(PIRATE_SPEC),
    );
    expect(second.message).toContain('pirate-rewrite');
  });
});
