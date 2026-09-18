import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { createDoctorCommandModule } from '../doctor-command-module.js';
import {
  createDoctorFixture,
  fixtureProviderDefinition,
  installBrokenHome,
} from './doctor-fixture.js';

import type { IDoctorFixture } from './doctor-fixture.js';
import { createTestCommandHost } from '@robota-sdk/agent-framework/testing';

import type { IUserInteraction, TActionResponse } from '@robota-sdk/agent-core';

const fixtures: IDoctorFixture[] = [];
afterEach(() => {
  for (const fixture of fixtures.splice(0)) fixture.cleanup();
});

/** The published conformant double, with only the interaction port overridden. */
function contextWith(interaction: IUserInteraction | undefined) {
  return createTestCommandHost({ overrides: { getUserInteraction: () => interaction } });
}

function answering(
  response: TActionResponse,
): IUserInteraction & { ask: ReturnType<typeof vi.fn> } {
  return { ask: vi.fn(async () => response) };
}

describe('/doctor command module (OBSERVABILITY-1991 TC-06)', () => {
  it('renders the same check set without constructing a provider or submitting input', async () => {
    const createProvider = vi.fn(() => {
      throw new Error('must not be called');
    });
    const fixture = createDoctorFixture({
      env: {},
      providerDefinitions: [fixtureProviderDefinition({ createProvider })],
    });
    fixtures.push(fixture);
    installBrokenHome(fixture);
    const module = createDoctorCommandModule(fixture.inputs, fixture.deps);
    const command = module.systemCommands?.[0];
    expect(command?.name).toBe('doctor');
    const result = await command!.execute(contextWith(undefined), '');
    expect(result.success).toBe(false);
    expect(result.message).toContain('settings.user.robota');
    expect(result.message).toContain('plugin.broken-plugin@fixture-market');
    expect(result.data).toMatchObject({
      failCount: expect.any(Number),
      repairable: ['settings.user.robota'],
    });
    expect(createProvider).not.toHaveBeenCalled();
  });

  it('repair without an interaction port or with a cancelled answer writes nothing', async () => {
    const fixture = createDoctorFixture({ env: {} });
    fixtures.push(fixture);
    installBrokenHome(fixture);
    const path = join(fixture.home, '.robota', 'settings.json');
    const command = createDoctorCommandModule(fixture.inputs, fixture.deps).systemCommands![0]!;

    const noPort = await command.execute(contextWith(undefined), 'repair settings.user.robota');
    expect(noPort.success).toBe(false);
    expect(readFileSync(path, 'utf8')).toBe('');

    const cancelled = answering({ type: 'cancelled' });
    const declined = await command.execute(contextWith(cancelled), 'repair settings.user.robota');
    expect(declined.success).toBe(false);
    expect(cancelled.ask).toHaveBeenCalledTimes(1);
    expect(readFileSync(path, 'utf8')).toBe('');

    const usage = await command.execute(contextWith(cancelled), 'repair');
    expect(usage.message).toContain('Usage');
  });

  it('repair with a confirmed answer applies the allowlisted writer and re-renders', async () => {
    const fixture = createDoctorFixture({ env: {} });
    fixtures.push(fixture);
    installBrokenHome(fixture);
    const path = join(fixture.home, '.robota', 'settings.json');
    const command = createDoctorCommandModule(fixture.inputs, fixture.deps).systemCommands![0]!;
    const yes = answering({ type: 'answer', values: ['yes'] });
    const result = await command.execute(contextWith(yes), 'repair settings.user.robota');
    expect(result.success).toBe(true);
    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual({});
    expect(result.data).toMatchObject({
      repair: 'settings.user.robota',
      applied: true,
      status: 'ok',
    });
    expect(yes.ask.mock.calls[0]?.[0]).toMatchObject({ id: 'doctor-repair:settings.user.robota' });
  });
});
