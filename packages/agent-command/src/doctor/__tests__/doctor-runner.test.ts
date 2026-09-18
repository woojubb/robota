import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { createRestrictedWorkspaceProjectAccess } from '@robota-sdk/agent-framework';
import { afterEach, describe, expect, it } from 'vitest';

import { renderDoctorReport } from '../doctor-render.js';
import { applyDoctorRepair, planDoctorRepair } from '../doctor-repair.js';
import { runDoctor } from '../doctor-runner.js';
import {
  MARKERS,
  createDoctorFixture,
  fixtureProviderDefinition,
  installBrokenHome,
} from './doctor-fixture.js';

import type { IDoctorFixture } from './doctor-fixture.js';
import type { IDoctorReport } from '../doctor-types.js';

const fixtures: IDoctorFixture[] = [];
afterEach(() => {
  for (const fixture of fixtures.splice(0)) fixture.cleanup();
});

function fixture(...args: Parameters<typeof createDoctorFixture>): IDoctorFixture {
  const created = createDoctorFixture(...args);
  fixtures.push(created);
  return created;
}

function byId(report: IDoctorReport, id: string) {
  const check = report.checks.find((candidate) => candidate.id === id);
  if (check === undefined)
    throw new Error(`no check ${id}; have ${report.checks.map((c) => c.id).join(', ')}`);
  return check;
}

const CLEAN_SETTINGS = {
  currentProvider: 'doctor-env',
  providers: {
    'doctor-env': { type: 'fixture', model: 'fixture-model', apiKey: '$ENV:ROBOTA_DOCTOR_MARKER' },
    'doctor-inactive': { type: 'fixture', model: 'fixture-model', apiKey: MARKERS.profile },
  },
};

describe('runDoctor (OBSERVABILITY-1991)', () => {
  it('TC-05/TC-02: names every failing path and cause in the broken HOME and exits 1', async () => {
    const f = fixture({ env: { ROBOTA_DOCTOR_MARKER: MARKERS.env } });
    installBrokenHome(f);
    const report = await runDoctor(f.inputs, f.deps);

    expect(report.exitCode).toBe(1);
    expect(byId(report, 'host.fixture').status).toBe('ok');
    const user = byId(report, 'settings.user.robota');
    expect(user).toMatchObject({
      status: 'fail',
      cause: 'empty',
      path: join(f.home, '.robota', 'settings.json'),
      repair: 'settings.user.robota',
    });
    const claude = byId(report, 'settings.user.claude');
    expect(claude.status).toBe('fail');
    expect(claude.path).toBe(join(f.home, '.claude', 'settings.json'));
    expect(claude.cause).toContain('schema-invalid');
    expect(claude.cause).toContain('defaultTrustLevel');
    expect(claude.cause).not.toContain('42');
    expect(claude.repair).toBeUndefined();
    expect(byId(report, 'settings.merge').status).toBe('warn');

    const broken = byId(report, 'plugin.broken-plugin@fixture-market');
    expect(broken.status).toBe('fail');
    expect(broken.path).toContain(join('broken-plugin', '1.0.0', '.claude-plugin', 'plugin.json'));
    const ghost = byId(report, 'mcp.plugin.mcp-plugin@fixture-market.ghost');
    expect(ghost).toMatchObject({ status: 'warn' });
    expect(ghost.cause).toContain('robota-doctor-missing-binary');
    expect(byId(report, 'mcp.activation').status).toBe('not-configured');
    expect(byId(report, 'mcp.connection').status).toBe('not-probed');
    expect(byId(report, 'hooks.execution').status).toBe('not-probed');
    expect(byId(report, 'storage.user').status).toBe('ok');
    expect(byId(report, 'storage.project').status).toBe('not-configured');
    expect(byId(report, 'workspace.trust').status).toBe('warn');
    expect(report.repairable).toEqual(['settings.user.robota']);
  });

  it('TC-03: no rendered line carries a marker secret from any input', async () => {
    const f = fixture({ env: { ROBOTA_DOCTOR_MARKER: MARKERS.env } });
    installBrokenHome(f);
    // Overwrite the schema-invalid layer with a syntax error beside a secret (the parser-snippet case).
    f.write('.claude/settings.json', `{"providers":{"x":{"apiKey": ${MARKERS.adjacent}}}}`);
    const report = await runDoctor(f.inputs, f.deps);
    const text = renderDoctorReport(report).join('\n');
    for (const marker of Object.values(MARKERS)) expect(text).not.toContain(marker);
    expect(byId(report, 'settings.user.claude').cause).toContain('invalid-json');
  });

  it('TC-03: masks the resolved credential and inactive-profile literals in a clean configuration', async () => {
    const f = fixture({ env: { ROBOTA_DOCTOR_MARKER: MARKERS.env } });
    f.mkdir('.robota');
    f.mkdir('.robota/sessions');
    f.write('.robota/settings.json', JSON.stringify(CLEAN_SETTINGS));
    const report = await runDoctor(f.inputs, f.deps);
    const text = renderDoctorReport(report).join('\n');
    expect(report.exitCode).toBe(0);
    expect(text).not.toContain(MARKERS.env);
    expect(text).not.toContain(MARKERS.profile);
    expect(byId(report, 'provider.resolution').cause).toContain('fixture (fixture-model)');
  });

  it('TC-03: a parse error in a settings layer never renders the file excerpt around the fault', async () => {
    const f = fixture({ env: {} });
    f.mkdir('.robota');
    f.mkdir('.robota/sessions');
    // Unquoted value: JSON.parse's message quotes the bytes around the fault, i.e. the credential.
    f.write(
      '.robota/settings.json',
      `{"currentProvider":"p","providers":{"p":{"apiKey": ${MARKERS.adjacent}}}}`,
    );
    const report = await runDoctor(f.inputs, f.deps);
    const text = renderDoctorReport(report, 'robota doctor').join('\n');
    expect(text).not.toContain(MARKERS.adjacent);
    expect(text).not.toContain(MARKERS.adjacent.slice(0, 10));
    expect(text).not.toContain('..."');
    expect(byId(report, 'provider.resolution')).toMatchObject({
      status: 'fail',
      cause: expect.stringContaining('SettingsParseError'),
    });
    expect(byId(report, 'settings.user.robota')).toMatchObject({ status: 'fail' });
  });

  it('TC-04: derives the reachability host from profile baseURL, then defaults.baseURL, then endpoint', async () => {
    const profile = fixture({ env: {} });
    profile.write(
      '.robota/settings.json',
      JSON.stringify({
        currentProvider: 'p',
        providers: {
          p: { type: 'fixture', model: 'm', apiKey: 'k1234', baseURL: 'http://127.0.0.1:9' },
        },
      }),
    );
    await runDoctor(profile.inputs, profile.deps);
    expect(profile.probes).toEqual([{ host: '127.0.0.1', port: 9 }]);

    const defaults = fixture({
      env: {},
      providerDefinitions: [
        fixtureProviderDefinition({
          defaults: { model: 'm', baseURL: 'https://compat.example/v1' },
          endpoint: undefined,
        }),
      ],
    });
    defaults.write(
      '.robota/settings.json',
      JSON.stringify({
        currentProvider: 'p',
        providers: { p: { type: 'fixture', model: 'm', apiKey: 'k1234' } },
      }),
    );
    await runDoctor(defaults.inputs, defaults.deps);
    expect(defaults.probes).toEqual([{ host: 'compat.example', port: 443 }]);

    const endpoint = fixture({ env: {} });
    endpoint.write(
      '.robota/settings.json',
      JSON.stringify({
        currentProvider: 'p',
        providers: { p: { type: 'fixture', model: 'm', apiKey: 'k1234' } },
      }),
    );
    const report = await runDoctor(endpoint.inputs, endpoint.deps);
    expect(endpoint.probes).toEqual([{ host: 'api.fixture.example', port: 443 }]);
    expect(byId(report, 'provider.reachability').cause).toContain('definition endpoint');

    const none = fixture({
      env: {},
      providerDefinitions: [fixtureProviderDefinition({ endpoint: undefined })],
    });
    none.write(
      '.robota/settings.json',
      JSON.stringify({
        currentProvider: 'p',
        providers: { p: { type: 'fixture', model: 'm', apiKey: 'k1234' } },
      }),
    );
    const noneReport = await runDoctor(none.inputs, none.deps);
    expect(none.probes).toEqual([]);
    expect(byId(noneReport, 'provider.reachability')).toMatchObject({ status: 'warn' });
  });

  it('TC-04: an unreachable host is warn, not fail, so an offline doctor still exits 0', async () => {
    const f = fixture({ env: {}, reachable: false });
    f.mkdir('.robota');
    f.mkdir('.robota/sessions');
    f.write(
      '.robota/settings.json',
      JSON.stringify({
        currentProvider: 'p',
        providers: { p: { type: 'fixture', model: 'm', apiKey: 'k1234' } },
      }),
    );
    const report = await runDoctor(f.inputs, f.deps);
    expect(byId(report, 'provider.reachability').status).toBe('warn');
    expect(report.exitCode).toBe(0);
  });

  it('TC-05: a missing user storage root is warn and repairable; non-posix mode is not-probed', async () => {
    const missing = fixture({ env: {} });
    const report = await runDoctor(missing.inputs, missing.deps);
    expect(byId(report, 'storage.user')).toMatchObject({ status: 'warn', repair: 'storage.user' });
    expect(byId(report, 'provider.resolution').status).toBe('fail');

    const win = fixture({ env: {}, guarantee: 'windows-acl' });
    win.mkdir('.robota');
    win.mkdir('.robota/sessions');
    expect(byId(await runDoctor(win.inputs, win.deps), 'storage.user').status).toBe('not-probed');
  });

  it('TC-05: a too-open storage directory is warn and repairable', async () => {
    const f = fixture({ env: {} });
    f.mkdir('.robota', 0o755);
    f.mkdir('.robota/sessions', 0o755);
    const report = await runDoctor(f.inputs, f.deps);
    expect(byId(report, 'storage.user')).toMatchObject({ status: 'warn', repair: 'storage.user' });
  });

  it('TC-07: repair rewrites only an empty user settings file, re-reads before writing, and is idempotent', async () => {
    const f = fixture({ env: {} });
    installBrokenHome(f);
    const path = join(f.home, '.robota', 'settings.json');

    expect(planDoctorRepair('nope', f.inputs, f.deps)).toMatchObject({ ok: false });
    expect(planDoctorRepair('settings.user.claude', f.inputs, f.deps)).toMatchObject({ ok: false });

    const refused = await applyDoctorRepair(
      'settings.user.robota',
      f.inputs,
      f.deps,
      async () => false,
    );
    expect(refused.applied).toBe(false);
    expect(readFileSync(path, 'utf8')).toBe('');

    // The state changes between confirmation and write: refused, nothing overwritten.
    const raced = await applyDoctorRepair('settings.user.robota', f.inputs, f.deps, async () => {
      f.write('.robota/settings.json', '{"language":"ko"}');
      return true;
    });
    expect(raced).toMatchObject({ applied: false });
    expect(readFileSync(path, 'utf8')).toBe('{"language":"ko"}');

    f.write('.robota/settings.json', '');
    const applied = await applyDoctorRepair(
      'settings.user.robota',
      f.inputs,
      f.deps,
      async () => true,
    );
    expect(applied.applied).toBe(true);
    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual({});
    expect(byId(await runDoctor(f.inputs, f.deps), 'settings.user.robota').status).toBe('ok');

    const again = await applyDoctorRepair(
      'settings.user.robota',
      f.inputs,
      f.deps,
      async () => true,
    );
    expect(again).toMatchObject({ applied: false });
  });

  it('TC-07: storage repair creates owner-only directories and is refused once clean', async () => {
    const f = fixture({ env: {} });
    const applied = await applyDoctorRepair('storage.user', f.inputs, f.deps, async () => true);
    expect(applied.applied).toBe(true);
    expect(statSync(join(f.home, '.robota', 'sessions')).mode & 0o077).toBe(0);
    expect(byId(await runDoctor(f.inputs, f.deps), 'storage.user').status).toBe('ok');
    expect(
      await applyDoctorRepair('storage.user', f.inputs, f.deps, async () => true),
    ).toMatchObject({ applied: false });
  });

  it('TC-05 (skills): a skill definition session discovery throws on is a fail check, not a warning', async () => {
    const f = fixture({ env: {} });
    f.mkdir('.robota');
    f.mkdir('.robota/sessions');
    f.write('.robota/settings.json', JSON.stringify(CLEAN_SETTINGS));
    f.write('.robota/skills/bad-effort/SKILL.md', '---\nname: bad\neffort: extreme\n---\nbody\n');
    f.write('.robota/skills/no-frontmatter/SKILL.md', 'just text\n');
    const report = await runDoctor(f.inputs, f.deps);
    expect(
      byId(report, `skill.${join('.robota', 'skills', 'bad-effort', 'SKILL.md')}`),
    ).toMatchObject({
      status: 'fail',
      cause: 'frontmatter-invalid',
      detail: [expect.stringContaining('received "extreme"')],
    });
    expect(
      byId(report, `skill.${join('.robota', 'skills', 'no-frontmatter', 'SKILL.md')}`).status,
    ).toBe('warn');
    expect(report.exitCode).toBe(1);
  });

  it('TC-05 (workspace.trust): a trust service that swallowed an error is a fail check naming the cause', async () => {
    const f = fixture({ env: {} });
    const report = await runDoctor(
      {
        ...f.inputs,
        projectAccess: createRestrictedWorkspaceProjectAccess(
          'store-unavailable',
          f.home,
          new RangeError('trust store is corrupt'),
        ),
      },
      f.deps,
    );
    const trust = byId(report, 'workspace.trust');
    expect(trust.status).toBe('fail');
    expect(trust.cause).toBe('store-unavailable: RangeError: trust store is corrupt');
    expect(trust.path).toBe(f.home);
    expect(report.exitCode).toBe(1);

    const untrusted = byId(await runDoctor(f.inputs, f.deps), 'workspace.trust');
    expect(untrusted).toMatchObject({ status: 'warn', cause: 'untrusted' });
  });

  it('TC-05: reports the quarantined provider endpoint without printing either credential', async () => {
    const f = fixture({ env: {} });
    f.mkdir('.robota');
    f.mkdir('.robota/sessions');
    f.write(
      '.robota/settings.json',
      JSON.stringify({
        currentProvider: 'q',
        providers: {
          q: {
            type: 'fixture',
            model: 'm',
            apiKey: MARKERS.profile,
            baseURL: 'http://127.0.0.1:9',
          },
        },
      }),
    );
    f.write(
      '.claude/settings.json',
      JSON.stringify({ providers: { q: { baseURL: 'http://127.0.0.1:10' } } }),
    );
    const report = await runDoctor(f.inputs, f.deps);
    expect(byId(report, 'provider.security')).toMatchObject({
      status: 'warn',
      cause: expect.stringContaining('quarantined'),
    });
    const text = renderDoctorReport(report, 'robota doctor').join('\n');
    expect(text).not.toContain(MARKERS.profile);
    expect(text).toContain('[provider.security] warn');
  });

  it('a throwing endpoint probe is a provider fail check, not a rejected run', async () => {
    const f = fixture({ env: {} });
    f.mkdir('.robota');
    f.mkdir('.robota/sessions');
    f.write('.robota/settings.json', JSON.stringify(CLEAN_SETTINGS));
    const deps = {
      ...f.deps,
      probeEndpoint: () => Promise.reject(new RangeError('socket table exhausted')),
    };
    const report = await runDoctor(f.inputs, deps);
    expect(byId(report, 'provider')).toMatchObject({
      status: 'fail',
      cause: expect.stringContaining('RangeError'),
    });
    expect(report.exitCode).toBe(1);
  });

  it('renders a composition failure as a fail check instead of crashing', async () => {
    const f = fixture({ env: {} });
    const report = await runDoctor(
      {
        ...f.inputs,
        compositionFailure: {
          id: 'workspace.composition',
          label: 'Workspace composition',
          status: 'fail',
          cause: 'WorkspaceAuthorityRequiredError: boom',
        },
      },
      f.deps,
    );
    expect(byId(report, 'workspace.composition').status).toBe('fail');
    expect(report.exitCode).toBe(1);
  });
});
