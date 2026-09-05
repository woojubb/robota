import { mkdtemp, mkdir, writeFile, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { LocalDagRuntimeProvider } from '@robota-sdk/dag-framework';
import { describe, expect, it } from 'vitest';

import { executeWorkflowsCatalog as executeWorkflowsCatalogWithProject } from '../catalog-command.js';
import { subcommandUsage, WORKFLOWS_SUBCOMMANDS } from '../subcommands.js';
import { executeWorkflowsValidate as executeWorkflowsValidateWithProject } from '../validate-command.js';
import { createWorkflowsCommandModule } from '../workflows-command-module.js';
import { createWorkflowProjectFixture } from './workflow-project-fixture.js';

import type { ICommandHostContext, ISystemCommand } from '@robota-sdk/agent-framework';
import { createTestCommandHost } from '@robota-sdk/agent-framework/testing';

const FAKE_CONTEXT = createTestCommandHost({ cwd: process.cwd() });

function workflowsCommand(
  project?: Awaited<ReturnType<typeof createWorkflowProjectFixture>>,
): ISystemCommand {
  const cmd = createWorkflowsCommandModule(project === undefined ? {} : { project })
    .systemCommands?.[0];
  if (!cmd) throw new Error('workflows system command missing');
  return cmd;
}

async function trustedWorkflowsCommand(root: string = process.cwd()): Promise<ISystemCommand> {
  return workflowsCommand(await createWorkflowProjectFixture(root));
}

async function executeWorkflowsValidate(file: string, root: string) {
  return executeWorkflowsValidateWithProject(file, await createWorkflowProjectFixture(root));
}

async function executeWorkflowsCatalog(root: string) {
  return executeWorkflowsCatalogWithProject(await createWorkflowProjectFixture(root));
}

async function knownNodeType(): Promise<string> {
  const manifests = await new LocalDagRuntimeProvider({ executionRoot: process.cwd() }).listNodes();
  const first = manifests[0];
  if (!first) throw new Error('node catalog is empty');
  return first.nodeType;
}

describe('workflows command module', () => {
  it('refuses project workflow discovery when no explicit project capability was injected', async () => {
    const dir = await realpath(await mkdtemp(join(tmpdir(), 'wf-restricted-')));
    await mkdir(join(dir, '.workflows'), { recursive: true });
    await writeFile(join(dir, '.workflows', 'canary.json'), '{}');
    const context = createTestCommandHost({ cwd: dir });

    const result = await workflowsCommand().execute(context, 'catalog');

    expect(result.success).toBe(false);
    expect(result.message).toContain('WorkspaceAuthorityRequired');
    expect(result.message).not.toContain('canary');
  });

  it('exposes a slash-free `workflows` command with create/list/catalog/validate/run subcommands', () => {
    const mod = createWorkflowsCommandModule();
    expect(mod.name).toBe('agent-command-workflows');
    const cmd = workflowsCommand();
    expect(cmd.name).toBe('workflows'); // canonical name has no leading slash
    const subs = (cmd.subcommands ?? []).map((s) => s.name);
    expect(subs).toContain('create');
    expect(subs).toContain('build');
    expect(subs).toContain('list');
    expect(subs).toContain('catalog');
    expect(subs).toContain('validate');
    expect(subs).toContain('run');
  });

  it('is model-invocable so the agent can author + run a workflow from chat (FLOW-007 Phase 4)', () => {
    const cmd = workflowsCommand();
    expect(cmd.modelInvocable).toBe(true);
    const create = (cmd.subcommands ?? []).find((s) => s.name === 'create');
    expect(create?.modelInvocable).toBe(true);
    // WORKFLOW-004: `build` (author + save, never run) is also model-invocable — strictly less
    // privileged than `create`.
    const build = (cmd.subcommands ?? []).find((s) => s.name === 'build');
    expect(build?.modelInvocable).toBe(true);
  });

  it('dispatches `build` and reports the build usage on empty args (WORKFLOW-004)', async () => {
    const result = await (await trustedWorkflowsCommand()).execute(FAKE_CONTEXT, 'build');
    expect(result.success).toBe(false);
    expect(result.message).toContain('Usage: /workflows build');
  });

  it('dispatches `list` to the in-process node catalog', async () => {
    const result = await (await trustedWorkflowsCommand()).execute(FAKE_CONTEXT, 'list');
    expect(result.success).toBe(true);
    expect(result.message).toContain('workflow nodes');
  });

  it('reports usage on empty args and fails on an unknown subcommand', async () => {
    const cmd = workflowsCommand();
    expect((await cmd.execute(FAKE_CONTEXT, '')).message).toContain('Usage');
    expect((await cmd.execute(FAKE_CONTEXT, 'bogus')).success).toBe(false);
  });

  // WORKFLOW-005 P3 anti-drift: `subcommands.ts` is the SSOT for the surface. Every registered
  // subcommand must be dispatched (no advertised-but-unroutable verb), every registered
  // argumentHint must match the `Usage:` line its executor emits, and the hint must be advertised
  // to the CLI verbatim.
  it('dispatches every registered subcommand (no advertised-but-unroutable verb)', async () => {
    const cmd = await trustedWorkflowsCommand();
    for (const sub of WORKFLOWS_SUBCOMMANDS) {
      const result = await cmd.execute(FAKE_CONTEXT, sub.name);
      expect(result.message, `subcommand "${sub.name}" is not dispatched`).not.toContain(
        'Unknown subcommand',
      );
    }
  });

  it('advertises each subcommand hint verbatim and derives its usage line from it', () => {
    const advertised = new Map(
      (workflowsCommand().subcommands ?? []).map((s) => [s.name, s.argumentHint]),
    );
    for (const sub of WORKFLOWS_SUBCOMMANDS) {
      expect(advertised.get(sub.name)).toBe(sub.argumentHint);
      const expected = sub.argumentHint
        ? `Usage: /workflows ${sub.name} ${sub.argumentHint}`
        : `Usage: /workflows ${sub.name}`;
      expect(subcommandUsage(sub.name)).toBe(expected);
    }
  });

  it('reports a usage error when `run`/`validate` are given no file', async () => {
    const cmd = await trustedWorkflowsCommand();
    expect((await cmd.execute(FAKE_CONTEXT, 'run')).message).toContain('Usage: /workflows run');
    expect((await cmd.execute(FAKE_CONTEXT, 'validate')).message).toContain(
      'Usage: /workflows validate',
    );
  });
});

describe('workflows validate', () => {
  it('accepts a definition whose node types exist in the catalog', async () => {
    const dir = await realpath(await mkdtemp(join(tmpdir(), 'wf-validate-')));
    const file = 'ok.dag.json';
    const definition = {
      dagId: 'ok',
      version: 1,
      status: 'draft',
      nodes: [{ nodeId: 'a', nodeType: await knownNodeType(), dependsOn: [], config: {} }],
      edges: [],
    };
    await writeFile(join(dir, file), JSON.stringify(definition));
    const result = await executeWorkflowsValidate(file, dir);
    expect(result.success).toBe(true);
    expect(result.message).toContain('Valid workflow');
  });

  it('rejects a definition with an unknown node type', async () => {
    const dir = await realpath(await mkdtemp(join(tmpdir(), 'wf-validate-')));
    const file = 'bad.dag.json';
    const definition = {
      dagId: 'bad',
      version: 1,
      status: 'draft',
      nodes: [{ nodeId: 'a', nodeType: 'definitely-not-a-real-node', dependsOn: [], config: {} }],
      edges: [],
    };
    await writeFile(join(dir, file), JSON.stringify(definition));
    const result = await executeWorkflowsValidate(file, dir);
    expect(result.success).toBe(false);
    expect(result.message).toContain('unknown node type');
  });

  it('rejects an unrecognized file shape', async () => {
    const dir = await realpath(await mkdtemp(join(tmpdir(), 'wf-validate-')));
    await writeFile(join(dir, 'x.dag.json'), JSON.stringify({ foo: 1 }));
    const result = await executeWorkflowsValidate('x.dag.json', dir);
    expect(result.success).toBe(false);
    expect(result.message).toContain('Not a DAG file');
  });
});

describe('workflows catalog', () => {
  it('reports an empty state when no workflows exist', async () => {
    const dir = await realpath(await mkdtemp(join(tmpdir(), 'wf-catalog-')));
    const result = await executeWorkflowsCatalog(dir);
    expect(result.success).toBe(true);
    expect(result.message).toContain('No workflow files');
  });

  it('lists workflow files flat under the workspace root (.workflows/)', async () => {
    const dir = await realpath(await mkdtemp(join(tmpdir(), 'wf-catalog-')));
    const catalogDir = join(dir, '.workflows');
    await mkdir(join(catalogDir, 'nodes'), { recursive: true });
    await writeFile(
      join(catalogDir, 'sample.json'),
      JSON.stringify({
        last_node_id: 1,
        last_link_id: 0,
        nodes: [{ id: 1 }],
        links: [],
        version: 0.4,
      }),
    );
    // a node manifest sharing the root must NOT be listed as a workflow.
    await writeFile(join(catalogDir, 'nodes', 'greet.node.json'), JSON.stringify({ kind: 'code' }));
    const result = await executeWorkflowsCatalog(dir);
    expect(result.success).toBe(true);
    expect(result.message).toContain('sample.json');
    expect(result.message).toContain('1 node(s)');
    expect(result.message).not.toContain('greet');
  });
});
