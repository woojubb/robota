/**
 * The provider modules have no process environment of their own: `$ENV:` references and a
 * definition's default credential variable are read against the environment they are handed (a fixed
 * map, or a resolver such as `host.env`), and read as unset when none is. A key sitting in
 * `process.env` is never found by accident.
 */

import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { createNodeHostSettingsSource } from '../../../config/node-host-settings-source.js';
import { checkSettingsDocument } from '../settings-check.js';
import {
  createProviderFromSettings,
  readProviderSettings,
  resolveEnvDefaultProvider,
} from '../provider-factory.js';
import { resolveProviderEnvironment } from '../provider-environment.js';
import { resolveActiveProvider } from '../provider-merge.js';
import { testProviderProfileCommand } from '../provider-command-probe.js';
import { buildProviderProfilesSnapshot } from '../provider-profile-summary.js';
import { buildProviderSetupPatch, validateProviderProfile } from '../provider-settings.js';

import type { IProviderDefinition } from '@robota-sdk/agent-core';
import type { IProviderCommandModuleOptions } from '../provider-command-types.js';
import type { TSettingsSource } from '../../../config/settings-source.js';

const KEY = 'ROBOTA_ENV_PORT_PROBE_KEY';

const DEFINITION: IProviderDefinition = {
  type: 'probe',
  displayName: 'Probe',
  requiresApiKey: true,
  defaults: { model: 'probe-model', apiKey: `$ENV:${KEY}` },
  createProvider: () => {
    throw new Error('not used in resolution tests');
  },
};

const roots: string[] = [];

/** A user settings source over a temporary file holding `document`. */
function documentSource(document: object): TSettingsSource {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'provider-environment-')));
  roots.push(root);
  const path = join(root, 'settings.json');
  writeFileSync(path, JSON.stringify(document));
  return createNodeHostSettingsSource('user', path);
}

afterEach(() => {
  vi.unstubAllEnvs();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('resolveProviderEnvironment', () => {
  it('reads every name as unset when no environment is given', () => {
    vi.stubEnv(KEY, 'from-process');
    expect(resolveProviderEnvironment(undefined)(KEY)).toBeUndefined();
  });

  it('reads a fixed map, and calls a resolver as it is', () => {
    expect(resolveProviderEnvironment({ [KEY]: 'from-map' })(KEY)).toBe('from-map');
    expect(resolveProviderEnvironment({ [KEY]: 'from-map' })('OTHER')).toBeUndefined();
    const resolver = vi.fn((name: string) => (name === KEY ? 'from-resolver' : undefined));
    expect(resolveProviderEnvironment(resolver)(KEY)).toBe('from-resolver');
    expect(resolver).toHaveBeenCalledWith(KEY);
  });
});

describe('a key in process.env is not found without an environment', () => {
  it('resolveEnvDefaultProvider finds no default provider', () => {
    vi.stubEnv(KEY, 'from-process');
    expect(resolveEnvDefaultProvider([DEFINITION])).toBeUndefined();
    expect(resolveEnvDefaultProvider([DEFINITION], { [KEY]: 'from-map' })?.apiKey).toBe('from-map');
    expect(
      resolveEnvDefaultProvider([DEFINITION], (name) => (name === KEY ? 'r' : undefined)),
    ).toMatchObject({
      name: 'probe',
      apiKey: 'r',
    });
  });

  it('readProviderSettings fails as an unconfigured host does, and succeeds with an environment', () => {
    vi.stubEnv(KEY, 'from-process');
    expect(() => readProviderSettings([], { providerDefinitions: [DEFINITION] })).toThrow(
      /No provider configuration found/,
    );
    expect(
      readProviderSettings([], { providerDefinitions: [DEFINITION], env: { [KEY]: 'k' } }),
    ).toMatchObject({ name: 'probe', apiKey: 'k' });
  });

  it('createProviderFromSettings leaves a profile credential unresolved, so the definition refuses it', () => {
    vi.stubEnv(KEY, 'from-process');
    const source = documentSource({
      currentProvider: 'p',
      providers: { p: { type: 'probe', model: 'm', apiKey: `$ENV:${KEY}` } },
    });
    expect(() =>
      createProviderFromSettings([source], undefined, { providerDefinitions: [DEFINITION] }),
    ).toThrow(/requires apiKey/);
  });

  it('resolveActiveProvider resolves a profile credential only against the environment it is given', () => {
    vi.stubEnv(KEY, 'from-process');
    const settings = {
      currentProvider: 'p',
      providers: { p: { type: 'probe', model: 'm', apiKey: `$ENV:${KEY}` } },
    };
    expect(resolveActiveProvider(settings, undefined, [DEFINITION])?.apiKey).toBeUndefined();
    expect(resolveActiveProvider(settings, undefined, [DEFINITION], { [KEY]: 'k' })?.apiKey).toBe(
      'k',
    );
  });

  it('buildProviderSetupPatch refuses an environment credential it cannot see', () => {
    vi.stubEnv(KEY, 'from-process');
    const input = { profile: 'p', type: 'probe', model: 'm', apiKeyEnv: KEY };
    expect(() => buildProviderSetupPatch(input, { providerDefinitions: [DEFINITION] })).toThrow(
      new RegExp(`Environment variable ${KEY} is not set`),
    );
    expect(
      buildProviderSetupPatch(input, { providerDefinitions: [DEFINITION], env: { [KEY]: 'k' } })
        .providers.p,
    ).toMatchObject({ apiKey: `$ENV:${KEY}` });
  });

  it('validateProviderProfile counts an unset reference as a missing credential', () => {
    vi.stubEnv(KEY, 'from-process');
    const profile = { type: 'probe', model: 'm', apiKey: `$ENV:${KEY}` };
    expect(() =>
      validateProviderProfile('p', profile, { providerDefinitions: [DEFINITION] }),
    ).toThrow(/missing apiKey/);
    expect(() =>
      validateProviderProfile('p', profile, {
        providerDefinitions: [DEFINITION],
        env: { [KEY]: 'k' },
      }),
    ).not.toThrow();
  });

  it('checkSettingsDocument calls the document incomplete until an environment answers', () => {
    vi.stubEnv(KEY, 'from-process');
    const document = {
      currentProvider: 'p',
      providers: { p: { type: 'probe', model: 'm', apiKey: `$ENV:${KEY}` } },
    };
    expect(checkSettingsDocument(document, [DEFINITION])).toBe('incomplete');
    expect(checkSettingsDocument(document, [DEFINITION], { [KEY]: 'k' })).toBe('valid');
    expect(
      checkSettingsDocument(document, [DEFINITION], (name) => (name === KEY ? 'k' : undefined)),
    ).toBe('valid');
  });

  it('buildProviderProfilesSnapshot reports a missing key until an environment answers', () => {
    vi.stubEnv(KEY, 'from-process');
    const providers = { p: { type: 'probe', model: 'm', apiKey: `$ENV:${KEY}` } };
    const missing = buildProviderProfilesSnapshot(providers, 'p', [DEFINITION]);
    expect(missing.profiles[0]?.connectionState).toBe('Key missing');
    const present = buildProviderProfilesSnapshot(providers, 'p', [DEFINITION], undefined, {
      [KEY]: 'k',
    });
    expect(present.profiles[0]?.connectionState).toBeUndefined();
  });

  it('testProviderProfileCommand does not probe a profile whose credential it cannot resolve', async () => {
    vi.stubEnv(KEY, 'from-process');
    const probeProfile = vi.fn().mockResolvedValue({ ok: true, message: 'reachable' });
    const options = (
      env?: IProviderCommandModuleOptions['env'],
    ): IProviderCommandModuleOptions => ({
      providerDefinitions: [{ ...DEFINITION, probeProfile }],
      settings: {
        readMergedSettings: () => ({}),
        readTargetSettings: () => ({}),
        writeTargetSettings: () => undefined,
      },
      ...(env === undefined ? {} : { env }),
    });
    const providers = { p: { type: 'probe', model: 'm', apiKey: `$ENV:${KEY}` } };
    const refused = await testProviderProfileCommand('p', providers, undefined, options());
    expect(refused.success).toBe(false);
    expect(probeProfile).not.toHaveBeenCalled();
    const probed = await testProviderProfileCommand(
      'p',
      providers,
      undefined,
      options({ [KEY]: 'k' }),
    );
    expect(probed.success).toBe(true);
    expect(probeProfile).toHaveBeenCalledWith(expect.objectContaining({ apiKey: 'k' }));
  });
});
