import { expect, it, vi } from 'vitest';
import { SystemCommandExecutor } from '@robota-sdk/agent-framework';
import { createTestCommandHost } from '@robota-sdk/agent-framework/testing';
import { createSkillsCommandModule } from '../skills-command-module.js';

it('offers supporting reads to the model under the composed semantic command identity', async () => {
  const module = createSkillsCommandModule({ contributionSources: [] });
  const executor = new SystemCommandExecutor([...(module.systemCommands ?? [])]);
  expect(executor.getSemanticRoles().skillResourceRead).toBe('skill-read');
  expect(executor.isModelInvocable('skill-read')).toBe(true);
  expect(
    executor.listModelInvocableCommands().find((command) => command.name === 'skill-read')
      ?.description,
  ).toContain('already activated');
  const resource = {
    uri: 'skill://demo/reference%20file.txt',
    digest: 'sha256:verified',
    size: 7,
    text: 'content',
  };
  const readSkillResource = vi.fn(async () => resource);
  const context = createTestCommandHost({ overrides: { readSkillResource } });
  const result = await executor.executeModelInvocable(
    'skill-read',
    context,
    JSON.stringify(['demo', resource.uri]),
  );
  expect(readSkillResource).toHaveBeenCalledWith('demo', resource.uri);
  expect(result).toMatchObject({ success: true, data: resource });
});

it.each(['', '{}', '["demo"]', '["demo", 3]', '["demo", "uri", "extra"]', '["", "uri"]'])(
  'refuses malformed resource arguments without calling the host: %s',
  async (args) => {
    const executor = new SystemCommandExecutor([
      ...(createSkillsCommandModule({ contributionSources: [] }).systemCommands ?? []),
    ]);
    const readSkillResource = vi.fn();
    const result = await executor.executeModelInvocable(
      'skill-read',
      createTestCommandHost({ overrides: { readSkillResource } }),
      args,
    );
    expect(result?.success).toBe(false);
    expect(readSkillResource).not.toHaveBeenCalled();
  },
);

it('reports an unavailable host instead of acquiring a skill or falling back to filesystem reads', async () => {
  const executor = new SystemCommandExecutor([
    ...(createSkillsCommandModule({ contributionSources: [] }).systemCommands ?? []),
  ]);
  const executeSkillCommandByName = vi.fn();
  const result = await executor.executeModelInvocable(
    'skill-read',
    createTestCommandHost({ overrides: { executeSkillCommandByName } }),
    '["demo", "skill://demo/file"]',
  );
  expect(result).toMatchObject({
    success: false,
    message: expect.stringContaining('does not provide'),
  });
  expect(executeSkillCommandByName).not.toHaveBeenCalled();
});
