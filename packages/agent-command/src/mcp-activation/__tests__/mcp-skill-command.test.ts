import { expect, it, vi } from 'vitest';
import { SystemCommandExecutor } from '@robota-sdk/agent-framework';
import { createTestCommandHost } from '@robota-sdk/agent-framework/testing';
import { executeMCPActivationCommand } from '../mcp-activation-command.js';
import { createMCPActivationCommandModule } from '../mcp-activation-command-module.js';
import type { TCommandInvocationSource } from '@robota-sdk/agent-interface-command';

const preview = {
  serverId: 'docs',
  uri: 'skill://docs/demo/SKILL.md',
  namespace: 'origin',
  fingerprint: 'a'.repeat(64),
  name: 'demo',
  description: 'Use this workflow',
  frontmatter: { name: 'demo', description: 'Use this workflow', 'allowed-tools': 'Write' },
  content: '---\nname: demo\n---\nInstructions for review.',
};
function fixture(source: TCommandInvocationSource | undefined, locality?: 'local' | 'remote') {
  const skills = {
    list: vi.fn(async () => [{ ...preview, content: undefined }]),
    inspect: vi.fn(async () => preview),
    approve: vi.fn(async () => preview),
    withdraw: vi.fn(),
  };
  const host = createTestCommandHost({
    overrides: {
      getCommandHostAdapters: () => ({
        mcpActivation: {
          list: () => [],
          approve: vi.fn(),
          reject: vi.fn(),
          revoke: vi.fn(),
          skills,
        },
      }),
      getCommandInvocationSource: () => source ?? 'user',
      getCommandSurfaceLocalityEvidence: () => locality,
    },
  });
  const {
    getCommandInvocationSource: _source,
    getCommandSurfaceLocalityEvidence: _locality,
    ...base
  } = host;
  return {
    skills,
    host: {
      ...base,
      ...(source === undefined ? {} : { getCommandInvocationSource: () => source }),
      ...(locality === undefined ? {} : { getCommandSurfaceLocalityEvidence: () => locality }),
    },
  };
}

it('lists model-visible metadata without inspecting or approving instructions', async () => {
  const f = fixture('model');
  const result = await executeMCPActivationCommand(f.host, 'skill-list docs');
  expect(result.success).toBe(true);
  expect(result.message).toContain('Use this workflow');
  expect(f.skills.list).toHaveBeenCalledWith('docs');
  expect(f.skills.inspect).not.toHaveBeenCalled();
  expect(f.skills.approve).not.toHaveBeenCalled();
});

it('shows exact content and supplies a content-bound approval command for the user', async () => {
  const f = fixture('user');
  const result = await executeMCPActivationCommand(
    f.host,
    'skill-inspect docs skill://docs/demo/SKILL.md',
  );
  expect(result.success).toBe(true);
  expect(result.message).toContain(preview.content);
  expect(result.message).toContain(
    `/mcp skill-approve docs skill://docs/demo/SKILL.md ${preview.fingerprint}`,
  );
  expect(f.skills.approve).not.toHaveBeenCalled();
});

it.each(['model', 'remote', undefined] as const)(
  'refuses consent actions from %s before dispatch',
  async (source) => {
    const f = fixture(source);
    for (const verb of ['skill-inspect', 'skill-approve', 'skill-withdraw']) {
      const result = await executeMCPActivationCommand(
        f.host,
        `${verb} docs skill://docs/demo/SKILL.md ${preview.fingerprint}`,
      );
      expect(result.success).toBe(false);
      expect(result.message).toContain('local user');
    }
    expect(f.skills.inspect).not.toHaveBeenCalled();
    expect(f.skills.approve).not.toHaveBeenCalled();
    expect(f.skills.withdraw).not.toHaveBeenCalled();
  },
);

it('allows a proven local app user and refuses another-device transport', async () => {
  const f = fixture('remote', 'local');
  expect(
    (
      await executeMCPActivationCommand(
        f.host,
        `skill-approve docs ${preview.uri} ${preview.fingerprint}`,
      )
    ).success,
  ).toBe(true);
  expect(f.skills.approve).toHaveBeenCalledWith('docs', preview.uri, preview.fingerprint, 'user');
  const remote = fixture('remote', 'remote');
  expect(
    (
      await executeMCPActivationCommand(
        remote.host,
        `skill-approve docs ${preview.uri} ${preview.fingerprint}`,
      )
    ).success,
  ).toBe(false);
  expect(remote.skills.approve).not.toHaveBeenCalled();
});

it('allows only metadata listing through the model command executor', async () => {
  const [command] = createMCPActivationCommandModule().systemCommands ?? [];
  const execute = vi.fn();
  const executor = new SystemCommandExecutor([{ ...command!, execute }]);
  for (const verb of ['skill-inspect', 'skill-approve', 'skill-withdraw'])
    expect(
      (await executor.executeModelInvocable('mcp', createTestCommandHost(), `${verb} docs`))
        ?.success,
    ).toBe(false);
  expect(execute).not.toHaveBeenCalled();
  await executor.executeModelInvocable('mcp', createTestCommandHost(), 'skill-list docs');
  expect(execute).toHaveBeenCalledOnce();
});

it('accepts JSON argument arrays for opaque names and URIs without shell evaluation', async () => {
  const f = fixture('user');
  const args = ['docs with spaces', 'skill://host/demo/SKILL.md?label=a b'];
  expect(
    (await executeMCPActivationCommand(f.host, `skill-inspect ${JSON.stringify(args)}`)).success,
  ).toBe(true);
  expect(f.skills.inspect).toHaveBeenCalledWith(...args);
});
