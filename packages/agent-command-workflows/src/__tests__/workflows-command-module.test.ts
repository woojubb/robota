import { describe, expect, it } from 'vitest';

import { createWorkflowsCommandModule } from '../workflows-command-module.js';

import type { ICommandHostContext, ISystemCommand } from '@robota-sdk/agent-framework';

const FAKE_CONTEXT = {} as ICommandHostContext;

function workflowsCommand(): ISystemCommand {
  const cmd = createWorkflowsCommandModule().systemCommands?.[0];
  if (!cmd) throw new Error('workflows system command missing');
  return cmd;
}

describe('workflows command module', () => {
  it('exposes a slash-free `workflows` command with list/run subcommands', () => {
    const mod = createWorkflowsCommandModule();
    expect(mod.name).toBe('agent-command-workflows');
    const cmd = workflowsCommand();
    expect(cmd.name).toBe('workflows'); // canonical name has no leading slash
    const subs = (cmd.subcommands ?? []).map((s) => s.name);
    expect(subs).toContain('list');
    expect(subs).toContain('run');
  });

  it('dispatches `list` to the in-process node catalog', async () => {
    const result = await workflowsCommand().execute(FAKE_CONTEXT, 'list');
    expect(result.success).toBe(true);
    expect(result.message).toContain('workflow nodes');
  });

  it('reports usage on empty args and fails on an unknown subcommand', async () => {
    const cmd = workflowsCommand();
    expect((await cmd.execute(FAKE_CONTEXT, '')).message).toContain('Usage');
    expect((await cmd.execute(FAKE_CONTEXT, 'bogus')).success).toBe(false);
  });

  it('reports a usage error when `run` is given no file', async () => {
    const result = await workflowsCommand().execute(FAKE_CONTEXT, 'run');
    expect(result.success).toBe(false);
    expect(result.message).toContain('Usage: /workflows run');
  });
});
