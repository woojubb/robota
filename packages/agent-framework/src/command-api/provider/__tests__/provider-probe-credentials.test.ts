import { describe, expect, it, vi } from 'vitest';
import { testProviderProfileCommand } from '../provider-command-probe.js';
import { buildProviderSetupPatch } from '../provider-settings.js';
import type { IProviderCommandModuleOptions } from '../provider-command-types.js';

describe('provider probe credentials', () => {
  it.each(['$ENV:MISSING_SERVER_TOKEN', '$ENV:'])(
    'rejects %s during optional-key setup before a patch is produced',
    (apiKey) => {
      const providerDefinitions = [
        {
          type: 'local',
          requiresApiKey: false,
          createProvider: () => {
            throw new Error('not used');
          },
        },
      ];
      expect(() =>
        buildProviderSetupPatch(
          {
            profile: 'local',
            type: 'local',
            model: 'installed-model',
            apiKey,
          },
          { providerDefinitions, env: {} },
        ),
      ).toThrow('missing apiKey');
    },
  );
  it('uses the selected host environment without mutating stored references', async () => {
    const probe = vi.fn().mockResolvedValue({ ok: true, message: '1 model discovered' });
    const profile = {
      type: 'local',
      model: 'installed-model',
      baseURL: 'http://localhost:1234/v1',
      apiKey: '$ENV:LOCAL_TOKEN',
    };
    const options = {
      providerDefinitions: [
        {
          type: 'local',
          requiresApiKey: false,
          probeProfile: probe,
          createProvider: () => {
            throw new Error('not used');
          },
        },
      ],
      env: { LOCAL_TOKEN: 'synthetic-selected-token' },
    } as unknown as IProviderCommandModuleOptions;

    await testProviderProfileCommand('local', { local: profile }, undefined, options);

    expect(probe).toHaveBeenCalledWith({ ...profile, apiKey: 'synthetic-selected-token' });
    expect(profile.apiKey).toBe('$ENV:LOCAL_TOKEN');
  });

  it('rejects an unresolved explicit token instead of probing anonymously', async () => {
    const probe = vi.fn();
    const options = {
      providerDefinitions: [
        {
          type: 'local',
          requiresApiKey: false,
          probeProfile: probe,
          createProvider: () => {
            throw new Error('not used');
          },
        },
      ],
      env: {},
    } as unknown as IProviderCommandModuleOptions;

    const result = await testProviderProfileCommand(
      'local',
      {
        local: { type: 'local', model: 'installed-model', apiKey: '$ENV:LOCAL_TOKEN' },
      },
      undefined,
      options,
    );

    expect(result.success).toBe(false);
    expect(result.message).toContain('LOCAL_TOKEN');
    expect(result.message).toContain('/provider edit local');
    expect(probe).not.toHaveBeenCalled();
  });

  it('names the profile edit action when a server rejects authentication', async () => {
    const probe = vi.fn().mockResolvedValue({ ok: false, message: 'HTTP 401' });
    const options = {
      providerDefinitions: [
        {
          type: 'local',
          requiresApiKey: false,
          probeProfile: probe,
          createProvider: () => {
            throw new Error('not used');
          },
        },
      ],
    } as unknown as IProviderCommandModuleOptions;

    const result = await testProviderProfileCommand(
      'local',
      {
        local: { type: 'local', model: 'installed-model' },
      },
      undefined,
      options,
    );

    expect(result.message).toContain('/provider edit local');
    expect(result.message).toContain('API key');
  });
});
