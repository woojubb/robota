import { describe, it, expect } from 'vitest';
import type { IAIProvider } from '@robota-sdk/agent-core';
import { createNodeHostSettingsSource } from '@robota-sdk/agent-framework';
import { createNodeHostContributionSource } from '@robota-sdk/agent-framework';
import type { IPromptHistoryOptions } from '@robota-sdk/agent-framework';
import type { ITuiCliAdapter } from '../tui-cli-adapter.js';
import { toChannelOptions } from '../render.js';
import { buildTuiSessionOptions } from '../tui-session-options.js';
import type { IRenderOptions } from '../render.js';

describe('toChannelOptions', () => {
  it('keeps host model identifiers through render, channel, and session', () => {
    const channel = toChannelOptions({
      cwd: '/tmp/project',
      provider: {} as IAIProvider,
      cliAdapter: {} as ITuiCliAdapter,
      promptFileReferenceTag: 'acme_files',
      modelCommandToolPrefix: 'acme_command_',
      observerFailureWarningCode: 'ACME_BACKGROUND_OBSERVER_FAILURE',
      subagentHookEnvironmentNames: { agentId: 'ACME_AGENT_ID', agentType: 'ACME_AGENT_TYPE' },
      commandHookShell: '/bin/bash',
    });
    const session = buildTuiSessionOptions(channel);
    expect(session.promptFileReferenceTag).toBe('acme_files');
    expect(session.modelCommandToolPrefix).toBe('acme_command_');
    expect(session.observerFailureWarningCode).toBe('ACME_BACKGROUND_OBSERVER_FAILURE');
    expect(session.subagentHookEnvironmentNames).toEqual({
      agentId: 'ACME_AGENT_ID',
      agentType: 'ACME_AGENT_TYPE',
    });
    expect('commandHookShell' in session && session.commandHookShell).toBe('/bin/bash');
  });

  it('keeps safe mode (no instructions, plugins or settings hooks) through render, channel, and session', () => {
    const channel = toChannelOptions({
      cwd: '/tmp/project',
      provider: {} as IAIProvider,
      cliAdapter: {} as ITuiCliAdapter,
      bare: true,
      skipConfiguredHooks: true,
    });
    const session = buildTuiSessionOptions(channel);
    expect('bare' in session && session.bare).toBe(true);
    expect('skipConfiguredHooks' in session && session.skipConfiguredHooks).toBe(true);
  });

  it('preserves host permission baselines through render, channel, and session', () => {
    const baselinePermissionAllow = ['Read(custom/**)'];
    const channel = toChannelOptions({
      cwd: '/tmp/project',
      provider: {} as IAIProvider,
      cliAdapter: {} as ITuiCliAdapter,
      baselinePermissionAllow,
    });
    const session = buildTuiSessionOptions(channel);
    if (!('baselinePermissionAllow' in session)) {
      throw new Error('TUI standard session options must preserve the host permission baseline.');
    }
    expect(session.baselinePermissionAllow).toBe(baselinePermissionAllow);
  });
  it('keeps the host task-context selection through render, channel, and session', () => {
    const taskContext = { enabled: true, dir: 'custom/tasks' };
    const channel = toChannelOptions({
      cwd: '/test-project',
      provider: {} as IAIProvider,
      cliAdapter: {} as ITuiCliAdapter,
      taskContext,
    });
    expect(channel.taskContext).toBe(taskContext);
    const session = buildTuiSessionOptions(channel);
    if (!('taskContext' in session)) {
      throw new Error(
        'TUI standard session options must preserve the host task-context selection.',
      );
    }
    expect(session.taskContext).toBe(taskContext);
  });

  it('keeps the host contribution sources and skill roots through render, channel, and session', () => {
    const sources = [createNodeHostContributionSource('/test-project')];
    const skillRoots = [{ root: 'custom/skills', kind: 'skills' as const }];
    const channel = toChannelOptions({
      cwd: '/test-project',
      provider: {} as IAIProvider,
      cliAdapter: {} as ITuiCliAdapter,
      contributionSources: sources,
      skillRoots,
    });
    const session = buildTuiSessionOptions(channel);
    if (!('contributionSources' in session) || !('skillRoots' in session)) {
      throw new Error('TUI standard session options must preserve host skill discovery settings.');
    }
    expect(session.contributionSources).toBe(sources);
    expect(session.skillRoots).toBe(skillRoots);
  });

  it('keeps the host user settings sources through render, channel, and session', () => {
    const sources = [createNodeHostSettingsSource('user', '/test-home/settings.json')];
    const channel = toChannelOptions({
      cwd: '/tmp/project',
      provider: {} as IAIProvider,
      cliAdapter: {} as ITuiCliAdapter,
      userSettingsSources: sources,
    });
    expect(buildTuiSessionOptions(channel).userSettingsSources).toBe(sources);
  });

  it('forwards the loop kill switch through the channel to the session', () => {
    const options = toChannelOptions({
      cwd: '/tmp/project',
      provider: {} as IAIProvider,
      cliAdapter: {} as ITuiCliAdapter,
      disableSessionLoops: true,
    });
    expect(options.disableSessionLoops).toBe(true);
    expect(buildTuiSessionOptions(options).disableSessionLoops).toBe(true);
  });

  it('TC-02: threads allowedTools and deniedTools into the channel options', () => {
    const renderOptions: IRenderOptions = {
      cwd: '/tmp/project',
      provider: {} as IAIProvider,
      cliAdapter: {} as ITuiCliAdapter,
      allowedTools: ['Read'],
      deniedTools: ['Bash'],
    };
    const channelOptions = toChannelOptions(renderOptions, 'session-1');
    expect(channelOptions.allowedTools).toEqual(['Read']);
    expect(channelOptions.deniedTools).toEqual(['Bash']);
    expect(channelOptions.resumeSessionId).toBe('session-1');
    expect(channelOptions.cwd).toBe('/tmp/project');
  });

  it('leaves tool filters undefined when not provided', () => {
    const channelOptions = toChannelOptions({
      cwd: '/tmp/project',
      provider: {} as IAIProvider,
      cliAdapter: {} as ITuiCliAdapter,
    });
    expect(channelOptions.allowedTools).toBeUndefined();
    expect(channelOptions.deniedTools).toBeUndefined();
  });

  it('CLI-076: threads the display modelId into the channel model override', () => {
    const channelOptions = toChannelOptions({
      cwd: '/tmp/project',
      provider: {} as IAIProvider,
      cliAdapter: {} as ITuiCliAdapter,
      modelId: 'claude-haiku-4-5-20251001',
    });
    // The status-line model id IS the session's model override (header == the model actually called).
    expect(channelOptions.model).toBe('claude-haiku-4-5-20251001');
  });

  it('CLI-076: leaves model undefined when no modelId is resolved', () => {
    const channelOptions = toChannelOptions({
      cwd: '/tmp/project',
      provider: {} as IAIProvider,
      cliAdapter: {} as ITuiCliAdapter,
    });
    expect(channelOptions.model).toBeUndefined();
  });

  it('carries the host external-event verifier factory to the session options', () => {
    const factory = () => ({ verify: async () => ({ admitted: true as const }) });
    const channelOptions = toChannelOptions({
      cwd: '/tmp/project',
      provider: {} as IAIProvider,
      cliAdapter: {} as ITuiCliAdapter,
      externalEventVerifierFactory: factory,
    });
    expect(channelOptions.externalEventVerifierFactory).toBe(factory);
    expect(buildTuiSessionOptions(channelOptions).externalEventVerifierFactory).toBe(factory);
  });

  it('SCREEN-1993: projects the prompt-history writer to the channel and on to the session options', () => {
    const promptHistory = { writer: { append: () => undefined }, project: '/p' };
    const channelOptions = toChannelOptions({
      cwd: '/tmp/project',
      provider: {} as IAIProvider,
      cliAdapter: {} as ITuiCliAdapter,
      promptHistory,
    });
    expect(channelOptions.promptHistory).toBe(promptHistory);
    // The session-options union hides standard-only fields; read the projected field by name.
    const session = (
      options: ReturnType<typeof toChannelOptions>,
    ): { promptHistory?: IPromptHistoryOptions } =>
      buildTuiSessionOptions(options) as { promptHistory?: IPromptHistoryOptions };
    expect(session(channelOptions).promptHistory).toBe(promptHistory);
    expect(
      session(
        toChannelOptions({
          cwd: '/tmp/project',
          provider: {} as IAIProvider,
          cliAdapter: {} as ITuiCliAdapter,
        }),
      ).promptHistory,
    ).toBeUndefined();
  });
});
