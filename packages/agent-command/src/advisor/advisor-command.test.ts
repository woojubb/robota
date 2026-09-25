import { describe, expect, it, vi } from 'vitest';

import { AdvisorController, createAdvisorTool } from '@robota-sdk/agent-framework';
import { createTestCommandHost } from '@robota-sdk/agent-framework/testing';

import { executeAdvisorCommand } from './advisor-command.js';

import type { IAIProvider } from '@robota-sdk/agent-core';
import type { ICommandSettingsDocument } from '@robota-sdk/agent-framework';

function advisorController(options: {
  registered: boolean;
  allowed?: string[];
}): AdvisorController {
  return new AdvisorController({
    ...(options.registered ? { spec: { profile: 'strong' } } : {}),
    resolveTarget: (spec) => {
      if (spec.profile === 'missing') throw new Error('Provider profile "missing" not found.');
      return {
        provider: {} as IAIProvider,
        model: `${spec.profile}-model`,
        destination: 'vendor-a@default',
      };
    },
    consent: { has: () => true, grant: () => undefined },
    ...(options.allowed ? { allowedProfiles: options.allowed } : {}),
  });
}

function host(advisor: AdvisorController | undefined, initial: ICommandSettingsDocument = {}) {
  let document: ICommandSettingsDocument = { ...initial };
  const write = vi.fn((next: ICommandSettingsDocument) => {
    document = next;
  });
  const context = createTestCommandHost({
    overrides: {
      getCommandHostAdapters: () => ({
        ...(advisor ? { advisor } : {}),
        settings: { read: () => document, write },
      }),
    },
  });
  return { context, write, read: () => document };
}

describe('/advisor', () => {
  it('saves the default and retargets the live advisor without changing the tool', async () => {
    const advisor = advisorController({ registered: true });
    const schema = JSON.stringify(createAdvisorTool(advisor).schema);
    const { context, read } = host(advisor, { theme: 'dark' });

    const result = await executeAdvisorCommand(context, 'other:big');

    expect(result.success).toBe(true);
    expect(read()).toEqual({ theme: 'dark', advisorModel: 'other:big' });
    expect(advisor.status()).toMatchObject({ target: 'other:big', enabled: true });
    expect(JSON.stringify(createAdvisorTool(advisor).schema)).toBe(schema);
  });

  it('turns the advisor off and removes the saved default', async () => {
    const advisor = advisorController({ registered: true });
    const { context, read } = host(advisor, { advisorModel: 'strong', theme: 'dark' });

    const result = await executeAdvisorCommand(context, 'off');

    expect(result.success).toBe(true);
    expect(read()).toEqual({ theme: 'dark' });
    expect(advisor.status().enabled).toBe(false);
  });

  it('says a new advisor takes effect next session when this one started without the tool', async () => {
    const { context } = host(advisorController({ registered: false }));
    const result = await executeAdvisorCommand(context, 'strong');
    expect(result.message).toContain('next session');
  });

  it('refuses a profile outside the organization allowlist and saves nothing', async () => {
    const { context, write } = host(advisorController({ registered: true, allowed: ['strong'] }));
    const result = await executeAdvisorCommand(context, 'elsewhere');
    expect(result.success).toBe(false);
    expect(result.message).toContain('organization policy');
    expect(write).not.toHaveBeenCalled();
  });

  it('refuses a profile that does not exist and saves nothing', async () => {
    const { context, write } = host(advisorController({ registered: true }));
    const result = await executeAdvisorCommand(context, 'missing');
    expect(result.success).toBe(false);
    expect(write).not.toHaveBeenCalled();
  });

  it('reports the current advisor', async () => {
    const { context } = host(advisorController({ registered: true }));
    const result = await executeAdvisorCommand(context, '');
    expect(result.message).toContain('Advisor: strong');
  });

  it('fails explicitly on a host without an advisor', async () => {
    const { context } = host(undefined);
    expect((await executeAdvisorCommand(context, '')).success).toBe(false);
  });
});
