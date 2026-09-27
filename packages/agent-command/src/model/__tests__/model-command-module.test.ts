import { describe, expect, it, vi } from 'vitest';

import { SystemCommandExecutor } from '@robota-sdk/agent-framework';
import { createTestCommandHost } from '@robota-sdk/agent-framework/testing';

import { createModelCommandEntry, createModelCommandModule } from '../model-command-module.js';

import type { IProviderCommandModuleOptions, IProviderProfileSettings } from '@robota-sdk/agent-framework';
import type { IProviderDefinition } from '@robota-sdk/agent-core';

function buildOptions(): IProviderCommandModuleOptions {
  const providers: Record<string, IProviderProfileSettings> = {
    anthropic: { type: 'anthropic', model: 'claude-sonnet-4-6' },
  };
  const definitions: readonly IProviderDefinition[] = [
    {
      type: 'anthropic',
      displayName: 'Anthropic',
      modelCatalog: { status: 'unavailable' },
      createProvider: () => {
        throw new Error('not used');
      },
    },
  ];
  const document = { currentProvider: 'anthropic', providers };
  return {
    providerDefinitions: definitions,
    settings: {
      readMergedSettings: () => document,
      readTargetSettings: () => document,
      writeTargetSettings: vi.fn(),
    },
  };
}

describe('createModelCommandModule (#3282 §2)', () => {
  it('is user-only: never model-invocable', () => {
    const entry = createModelCommandEntry();
    expect(entry.modelInvocable).toBe(false);

    const module = createModelCommandModule(buildOptions());
    const command = module.systemCommands?.[0];
    expect(command?.modelInvocable).toBe(false);
  });

  it('carries a model-facing description, name and argument hint', () => {
    const entry = createModelCommandEntry();
    expect(entry).toEqual(
      expect.objectContaining({
        name: 'model',
        displayName: 'Model',
        description: 'Show/change the model',
        argumentHint: '[<id>]',
        source: 'model',
      }),
    );
  });

  it('provides the metadata and the executable command from one module owner', () => {
    const module = createModelCommandModule(buildOptions());
    expect(module.name).toBe('agent-command-model');
    const entry = module.commandSources?.[0]?.getCommands()[0];
    const command = module.systemCommands?.[0];
    expect(entry?.name).toBe('model');
    expect(command?.name).toBe('model');
    expect(command?.lifecycle).toBe('inline');
  });

  it('runs "/model <id>" through the SDK command executor', async () => {
    const executor = new SystemCommandExecutor([
      ...(createModelCommandModule(buildOptions()).systemCommands ?? []),
    ]);
    const host = createTestCommandHost({ session: { getModelId: () => 'claude-sonnet-4-6' } });

    const result = await executor.execute('model', host, 'not-a-real-model');

    expect(result?.success).toBe(false);
    expect(result?.message).toBe('Unknown model "not-a-real-model". Run /model to see the choices.');
  });
});
