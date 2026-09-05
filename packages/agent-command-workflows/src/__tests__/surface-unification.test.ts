/**
 * WORKFLOW-005 P3 — surface unification across the `/workflows` subcommands.
 *
 * Two invariants the six subcommands must share:
 *
 * 1. **One node catalog.** `create`/`build`/`run` already reload the workspace-saved instant nodes
 *    under `<root>/nodes/`; `validate` and `list` must see the SAME catalog. Otherwise `build`'s own
 *    "Next steps: /workflows validate <path>" hand-off fails for every workflow `build` authored with
 *    a `newNodes` prompt node, and `list` hides the nodes the user just created.
 * 2. **One argument grammar.** The file-taking subcommands (`validate`, `run`) must parse their
 *    argument with the same quote-aware tokenizer `create`/`build` use, and reject surplus/unknown
 *    tokens explicitly instead of folding them into the path.
 */
import { mkdtemp, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createAssistantMessage } from '@robota-sdk/agent-core';
import type { IAIProvider } from '@robota-sdk/agent-core';

import { executeWorkflowsBuild as executeWorkflowsBuildWithProject } from '../build-command.js';
import type { IWorkflowsAuthoringDeps } from '../authoring/args.js';
import { executeWorkflowsList as executeWorkflowsListWithProject } from '../list-command.js';
import { executeWorkflowsRun as executeWorkflowsRunWithProject } from '../run-command.js';
import { executeWorkflowsValidate as executeWorkflowsValidateWithProject } from '../validate-command.js';
import { createWorkflowProjectFixture } from './workflow-project-fixture.js';

async function executeWorkflowsBuild(args: string, root: string, deps?: IWorkflowsAuthoringDeps) {
  return executeWorkflowsBuildWithProject(args, await createWorkflowProjectFixture(root), deps);
}

async function executeWorkflowsList(
  root: string,
  layout?: Parameters<typeof executeWorkflowsListWithProject>[1],
) {
  return executeWorkflowsListWithProject(await createWorkflowProjectFixture(root), layout);
}

async function executeWorkflowsRun(
  args: string,
  root: string,
  layout?: Parameters<typeof executeWorkflowsRunWithProject>[2],
) {
  return executeWorkflowsRunWithProject(args, await createWorkflowProjectFixture(root), layout);
}

async function executeWorkflowsValidate(
  args: string,
  root: string,
  layout?: Parameters<typeof executeWorkflowsValidateWithProject>[2],
) {
  return executeWorkflowsValidateWithProject(
    args,
    await createWorkflowProjectFixture(root),
    layout,
  );
}

/** A provider stub whose `chat` always returns the given JSON string as assistant content. */
function stubProvider(specJson: string): IAIProvider {
  return {
    chat: async () => createAssistantMessage(specJson),
  } as unknown as IAIProvider;
}

/** An authored spec that introduces a NEW prompt-backed node (`pirate-speak`). */
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

const UPPERCASE_SPEC = JSON.stringify({
  name: 'uppercase-it',
  pipeline: [{ nodeType: 'input' }, { nodeType: 'text-upper' }, { nodeType: 'text-output' }],
  sampleInput: { text: 'hello world' },
});

let dir: string;

beforeEach(async () => {
  dir = await realpath(await mkdtemp(join(tmpdir(), 'wf-p3-')));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function baseDeps(specJson: string): IWorkflowsAuthoringDeps {
  return {
    resolveProvider: () => stubProvider(specJson),
    now: () => '2026-07-25T00:00:00.000Z',
  };
}

describe('P3-A: one node catalog across subcommands', () => {
  // ARCH-047: project mutation is Linux-only (stable root-anchored host); refused elsewhere.
  it.runIf(process.platform === 'linux')(
    'validates a workflow that `build` authored with a new prompt node',
    async () => {
      const built = await executeWorkflowsBuild(
        '"rewrite as a pirate"',
        dir,
        baseDeps(PIRATE_SPEC),
      );
      expect(built.success).toBe(true);

      // `build` tells the user to run exactly this; it must not fail on the node build just saved.
      const savedPath = join('.workflows', 'pirate-rewrite.json');
      const validated = await executeWorkflowsValidate(savedPath, dir);
      expect(validated.message).not.toContain('unknown node type');
      expect(validated.success).toBe(true);
    },
  );

  // ARCH-047: project mutation is Linux-only (stable root-anchored host); refused elsewhere.
  it.runIf(process.platform === 'linux')(
    'lists workspace-saved instant nodes alongside the built-in node catalog',
    async () => {
      const built = await executeWorkflowsBuild(
        '"rewrite as a pirate"',
        dir,
        baseDeps(PIRATE_SPEC),
      );
      expect(built.success).toBe(true);

      const listed = await executeWorkflowsList(dir);
      expect(listed.success).toBe(true);
      expect(listed.message).toContain('pirate-speak');
    },
  );

  it('still lists the built-in nodes when the workspace has no saved nodes', async () => {
    const listed = await executeWorkflowsList(dir);
    expect(listed.success).toBe(true);
    expect(listed.message).toContain('input');
  });
});

describe('P3-B: one argument grammar across subcommands', () => {
  // ARCH-047: project mutation is Linux-only (stable root-anchored host); refused elsewhere.
  it.runIf(process.platform === 'linux')(
    'accepts a quoted file argument for `validate` and `run` (same tokenizer as create/build)',
    async () => {
      const built = await executeWorkflowsBuild(
        '"uppercase the text" --input text=hi',
        dir,
        baseDeps(UPPERCASE_SPEC),
      );
      expect(built.success).toBe(true);
      const savedPath = join('.workflows', 'uppercase-it.json');

      const validated = await executeWorkflowsValidate(`"${savedPath}"`, dir);
      expect(validated.success).toBe(true);

      const ran = await executeWorkflowsRun(`"${savedPath}"`, dir);
      expect(ran.success).toBe(true);
      expect(ran.message).toContain('HI');
    },
  );

  it('rejects surplus arguments instead of folding them into the file path', async () => {
    const validated = await executeWorkflowsValidate('a.json b.json', dir);
    expect(validated.success).toBe(false);
    expect(validated.message).toContain('Usage: /workflows validate');

    const ran = await executeWorkflowsRun('a.json --input text=hi', dir);
    expect(ran.success).toBe(false);
    expect(ran.message).toContain('Usage: /workflows run');
  });
});
