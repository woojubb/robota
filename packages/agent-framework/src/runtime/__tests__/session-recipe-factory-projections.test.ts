import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { IInteractiveSessionStandardOptions } from '../../interactive/interactive-session-options.js';

const { buildRuntimeSession } = vi.hoisted(() => ({
  buildRuntimeSession: vi.fn((_recipe: unknown) => ({
    on: vi.fn(),
    off: vi.fn(),
    listCommands: vi.fn(() => []),
    shutdown: vi.fn(async () => undefined),
  })),
}));

vi.mock('../runtime-host.js', async () => {
  const actual = await vi.importActual<typeof import('../runtime-host.js')>('../runtime-host.js');
  return {
    ...actual,
    buildRuntimeSession: (recipe: IInteractiveSessionStandardOptions) => buildRuntimeSession(recipe),
  };
});

const { createQuery } = await import('../../query.js');
const { createAgentRuntime } = await import('../agent-runtime.js');
const { createInteractiveRuntime } = await import('../../interaction/createInteractiveRuntime.js');
const { MockInteractionChannel } = await import('../../interaction/__tests__/MockInteractionChannel.js');

const provider = { name: 'recipe-test-provider' } as IInteractiveSessionStandardOptions['provider'];

beforeEach(() => buildRuntimeSession.mockClear());
describe('public session factories project into the SessionRecipe kernel', () => {
  it('projects query options through the kernel', () => {
    const userSettingsSources: NonNullable<IInteractiveSessionStandardOptions['userSettingsSources']> = [];
    const additionalTools: NonNullable<IInteractiveSessionStandardOptions['additionalTools']> = [];
    const permissionHandler = vi.fn();
    const onTextDelta = vi.fn();
    const queryOptions = {
      provider,
      cwd: process.cwd(),
      userSettingsSources,
      permissionMode: 'bypassPermissions' as const,
      maxTurns: 3,
      additionalTools,
      responseFormat: { type: 'json_object' as const },
      permissionHandler,
      onTextDelta,
    };

    createQuery(queryOptions);

    expect(buildRuntimeSession).toHaveBeenCalledOnce();
    expect(buildRuntimeSession).toHaveBeenCalledWith({
      cwd: queryOptions.cwd,
      provider,
      projectAccess: expect.objectContaining({ status: 'restricted' }),
      userSettingsSources,
      permissionMode: 'bypassPermissions',
      maxTurns: 3,
      additionalTools,
      responseFormat: { type: 'json_object' },
    });
  });

  it('projects inherited and session-specific runtime options through the kernel', () => {
    const runtimeOptions = {
      cwd: process.cwd(),
      provider,
      userSettingsSources: [],
      commandModules: [],
      commandHostAdapters: {},
      backgroundTaskRunners: [],
      subagentRunnerFactory: vi.fn(),
      sessionStore: undefined,
      orgPolicy: { rules: [] } as never,
      remoteCommandPolicy: { allow: [] } as never,
    };
    const runtime = createAgentRuntime(runtimeOptions);
    const sessionOptions = {
      permissionMode: 'default' as const,
      maxTurns: 5,
      sessionName: 'runtime-session',
      bare: true,
      allowedTools: ['read'],
      deniedTools: ['write'],
      model: 'model-x',
      appendSystemPrompt: 'append',
      systemPrompt: 'replace',
      agentName: 'agent-x',
      additionalTools: [],
      responseFormat: { type: 'json_object' as const },
    };

    runtime.createSession(sessionOptions);

    expect(buildRuntimeSession).toHaveBeenCalledOnce();
    expect(buildRuntimeSession).toHaveBeenCalledWith({
      cwd: runtimeOptions.cwd,
      provider,
      projectAccess: expect.objectContaining({ status: 'restricted' }),
      userSettingsSources: [],
      backgroundTaskRunners: runtimeOptions.backgroundTaskRunners,
      subagentRunnerFactory: runtimeOptions.subagentRunnerFactory,
      commandModules: [],
      commandHostAdapters: {},
      permissionMode: 'default',
      maxTurns: 5,
      sessionStore: undefined,
      sessionName: 'runtime-session',
      bare: true,
      allowedTools: ['read'],
      deniedTools: ['write'],
      model: 'model-x',
      appendSystemPrompt: 'append',
      systemPrompt: 'replace',
      shellExec: undefined,
      agentName: 'agent-x',
      orgPolicy: runtimeOptions.orgPolicy,
      remoteCommandPolicy: runtimeOptions.remoteCommandPolicy,
      additionalTools: [],
      resumeSessionId: undefined,
      responseFormat: { type: 'json_object' },
    });
  });

  it('requires production provider and cwd and projects interactive options through the kernel', async () => {
    const channel = new MockInteractionChannel();
    const runtime = createInteractiveRuntime({
      channel,
      commandModules: [],
      provider,
      cwd: process.cwd(),
      userSettingsSources: [],
      sessionStore: undefined,
      permissionMode: 'default',
    });

    await runtime.start();

    expect(buildRuntimeSession).toHaveBeenCalledOnce();
    expect(buildRuntimeSession).toHaveBeenCalledWith({
      provider,
      cwd: process.cwd(),
      projectAccess: undefined,
      userSettingsSources: [],
      sessionStore: undefined,
      commandModules: [],
      permissionMode: 'default',
    });
    await runtime.stop();
  });
});
