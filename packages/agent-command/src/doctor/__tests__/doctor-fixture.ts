import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  createNodeHostContributionSource,
  createNodeHostSettingsSource,
  createRestrictedWorkspaceProjectAccess,
} from '@robota-sdk/agent-framework';

import { inspectPathFacts } from '../doctor-node-deps.js';

import type { IDoctorDeps, IDoctorInputs } from '../doctor-types.js';
import type { IProviderDefinition } from '@robota-sdk/agent-core';

export const MARKERS = {
  env: 'sk-doctor-marker-env-1a2b3c',
  profile: 'sk-doctor-marker-profile-4d5e6f',
  mcp: 'sk-doctor-marker-mcp-9f8e7d',
  adjacent: 'sk-doctor-marker-adjacent-7c8d9e',
} as const;

export interface IDoctorFixture {
  readonly home: string;
  readonly inputs: IDoctorInputs;
  readonly deps: IDoctorDeps;
  readonly probes: { host: string; port: number }[];
  write(relative: string, content: string): string;
  mkdir(relative: string, mode?: number): string;
  cleanup(): void;
}

/** A provider definition whose SDK-embedded host is declared through `endpoint`, like anthropic. */
export function fixtureProviderDefinition(
  overrides: Partial<IProviderDefinition> = {},
): IProviderDefinition {
  return {
    type: 'fixture',
    displayName: 'Fixture',
    defaults: { model: 'fixture-model', apiKey: '$ENV:ROBOTA_DOCTOR_FIXTURE_KEY' },
    endpoint: { host: 'api.fixture.example', port: 443 },
    createProvider: () => {
      throw new Error('the doctor must never construct a provider');
    },
    ...overrides,
  };
}

interface IDoctorFixtureOptions {
  env?: Record<string, string | undefined>;
  providerDefinitions?: readonly IProviderDefinition[];
  reachable?: boolean;
  resolvable?: readonly string[];
  guarantee?: 'posix-mode' | 'windows-acl';
}

function fixtureDeps(
  options: IDoctorFixtureOptions,
  probes: { host: string; port: number }[],
): IDoctorDeps {
  const resolvable = new Set(options.resolvable ?? []);
  return {
    probeEndpoint: async (host, port) => {
      probes.push({ host, port });
      return options.reachable === false
        ? { reachable: false, error: 'connect ECONNREFUSED' }
        : { reachable: true, elapsedMs: 1 };
    },
    // Real filesystem facts, so the storage probe is exercised against the fixture HOME.
    inspectPath: inspectPathFacts,
    resolveCommand: (command) => resolvable.has(command.split(/\s+/)[0] ?? command),
    ownerOnlyGuarantee: () => options.guarantee ?? 'posix-mode',
  };
}

export function createDoctorFixture(options: IDoctorFixtureOptions = {}): IDoctorFixture {
  const home = mkdtempSync(join(tmpdir(), 'robota-doctor-fixture-'));
  const write = (relative: string, content: string): string => {
    const path = join(home, relative);
    mkdirSync(join(path, '..'), { recursive: true });
    writeFileSync(path, content, 'utf8');
    return path;
  };
  const mkdir = (relative: string, mode = 0o700): string => {
    const path = join(home, relative);
    mkdirSync(path, { recursive: true });
    chmodSync(path, mode);
    return path;
  };
  const probes: { host: string; port: number }[] = [];
  const env = options.env ?? {};
  const inputs: IDoctorInputs = {
    cwd: home,
    userHome: home,
    userSettingsPath: join(home, '.robota', 'settings.json'),
    userStorage: { root: join(home, '.robota'), sessions: join(home, '.robota', 'sessions') },
    settingsSources: [
      createNodeHostSettingsSource('user', join(home, '.robota', 'settings.json')),
      createNodeHostSettingsSource('user', join(home, '.claude', 'settings.json')),
    ],
    projectAccess: createRestrictedWorkspaceProjectAccess('untrusted', home),
    providerDefinitions: options.providerDefinitions ?? [fixtureProviderDefinition()],
    env,
    contributionSources: [createNodeHostContributionSource(home)],
    skillRoots: [{ root: join('.robota', 'skills'), kind: 'skills' }],
    pluginsDirs: [join(home, '.robota', 'plugins')],
    hostChecks: [
      { id: 'host.fixture', label: 'Fixture host check', status: 'ok', cause: 'present' },
    ],
  };
  const deps = fixtureDeps(options, probes);
  return {
    home,
    inputs,
    deps,
    probes,
    write,
    mkdir,
    cleanup: () => rmSync(home, { recursive: true, force: true }),
  };
}

/** The "broken HOME" of the built-CLI scenario, as a unit fixture. */
export function installBrokenHome(fixture: IDoctorFixture): void {
  fixture.mkdir('.robota');
  fixture.mkdir('.robota/sessions');
  fixture.write('.robota/settings.json', '');
  fixture.write('.claude/settings.json', '{"defaultTrustLevel":42}');
  fixture.write(
    '.robota/plugins/cache/fixture-market/broken-plugin/1.0.0/.claude-plugin/plugin.json',
    '{',
  );
  fixture.write(
    '.robota/plugins/cache/fixture-market/mcp-plugin/1.0.0/.claude-plugin/plugin.json',
    JSON.stringify({ name: 'mcp-plugin', version: '1.0.0', description: 'doctor fixture' }),
  );
  fixture.write(
    '.robota/plugins/cache/fixture-market/mcp-plugin/1.0.0/.mcp.json',
    JSON.stringify({
      mcpServers: {
        ghost: { command: 'robota-doctor-missing-binary', env: { GHOST_TOKEN: MARKERS.mcp } },
      },
    }),
  );
}
