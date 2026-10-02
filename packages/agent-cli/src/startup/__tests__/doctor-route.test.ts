import { createTestProductRuntime } from '../../__tests__/helpers/product-runtime.js';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createRestrictedWorkspaceProjectAccess } from '@robota-sdk/agent-framework';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { parseDoctorRouteArgs, runDoctorRoute } from '../doctor-route.js';
import { buildDoctorInputs } from '../doctor-inputs.js';
import { runPreparsedCliCommand } from '../preparsed-command-routing.js';
import { createCapturingTerminal } from './test-terminal.js';

import type { IProviderDefinition } from '@robota-sdk/agent-core';

const homes: string[] = [];
const savedHome = process.env['HOME'];
const savedExit = process.exitCode;
afterEach(() => {
  process.env['HOME'] = savedHome;
  process.exitCode = savedExit;
  for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true });
});

function isolatedHome(): string {
  const home = mkdtempSync(join(tmpdir(), 'test-product-doctor-route-'));
  homes.push(home);
  return home;
}

/** A definition that fails the run if anything constructs a provider. */
const createProvider = vi.fn(() => {
  throw new Error('the doctor route must never construct a provider');
});
const definitions: IProviderDefinition[] = [
  {
    type: 'fixture',
    defaults: { model: 'm', apiKey: '$ENV:PRODUCT_DOCTOR_ROUTE_KEY' },
    createProvider,
  },
];

describe('test-product doctor route (OBSERVABILITY-1991 TC-01)', () => {
  it('parses only --repair <id> and --yes; anything else is an error, not a global-parser rejection', () => {
    expect(parseDoctorRouteArgs([])).toEqual({ yes: false });
    expect(parseDoctorRouteArgs(['--repair', 'x', '--yes'])).toEqual({ repair: 'x', yes: true });
    expect(parseDoctorRouteArgs(['--repair=x', '-y'])).toEqual({ repair: 'x', yes: true });
    expect(parseDoctorRouteArgs(['--repair'])).toMatchObject({
      error: expect.stringContaining('check-id'),
    });
    expect(parseDoctorRouteArgs(['--bogus'])).toMatchObject({
      error: expect.stringContaining('--bogus'),
    });
  });

  it('dispatches doctor, checkup and diagnose from the pre-parse route before any composition', async () => {
    const home = isolatedHome();
    process.env['HOME'] = home;
    for (const name of ['doctor', 'checkup', 'diagnose']) {
      process.exitCode = undefined;
      const handled = await runPreparsedCliCommand(
        {productRuntime: createTestProductRuntime('test-product', { HOME: process.env['HOME'] }),
          providerDefinitions: definitions,
          projectAccess: createRestrictedWorkspaceProjectAccess('untrusted', home),
        },
        ['node', 'test-product', name, '--yes'],
        home,
      );
      expect(handled).toBe(true);
      expect(process.exitCode).toBe(1); // no provider configured in an empty HOME → provider.resolution fails
    }
    expect(createProvider).not.toHaveBeenCalled();
  });

  it('prints the same check set for every name and exits 0 on a clean configuration', async () => {
    const home = isolatedHome();
    mkdirSync(join(home, '.test-product', 'sessions'), { recursive: true, mode: 0o700 });
    writeFileSync(
      join(home, '.test-product', 'settings.json'),
      JSON.stringify({
        currentProvider: 'p',
        providers: {
          p: { type: 'fixture', model: 'm', apiKey: 'k1234', baseURL: 'http://127.0.0.1:9' },
        },
      }),
    );
    const outputs: string[] = [];
    for (const name of ['doctor', 'checkup', 'diagnose']) {
      const { terminal, lines } = createCapturingTerminal();
      const code = await runDoctorRoute(
        {
          version: '0.0.0-test',
          terminal,
          cwd: home,
          options: {productRuntime: createTestProductRuntime('test-product', { HOME: home }),
            providerDefinitions: definitions,
            projectAccess: createRestrictedWorkspaceProjectAccess('untrusted', home),
          },
          isTTY: false,
          env: {},
          userHome: home,
        },
        [],
        name,
      );
      expect(code).toBe(0);
      const text = lines.join('\n');
      expect(text).toContain(`test-product ${name}`);
      expect(text).toContain('test-product Agent may work');
      expect(text).toContain('test-product trust --yes');
      outputs.push(text.replace(`test-product ${name}`, 'test-product <name>'));
    }
    expect(
      new Set(outputs.map((o) => o.replace(/reachable in \d+ms|unreachable: .*$/gm, 'REACH'))).size,
    ).toBe(1);
    expect(outputs[0]).toContain('[settings.user.test-product] ok');
    expect(outputs[0]).toContain('[mcp.activation] not-configured');
  });

  it('keeps the test-product Agent provider remediation in the routed doctor output', async () => {
    const home = isolatedHome();
    const { terminal, lines } = createCapturingTerminal();
    const code = await runDoctorRoute({
      version: '0.0.0-test', terminal, cwd: home,
      options: {productRuntime: createTestProductRuntime('test-product', { HOME: home }),
        providerDefinitions: definitions,
        projectAccess: createRestrictedWorkspaceProjectAccess('untrusted', home),
      },
      isTTY: false, env: {}, userHome: home,
    }, []);
    expect(code).toBe(1);
    expect(lines.join('\n')).toContain('test-product --configure');
  });

  it('refuses --repair without --yes in a non-TTY and applies it with --yes', async () => {
    const home = isolatedHome();
    mkdirSync(join(home, '.test-product', 'sessions'), { recursive: true, mode: 0o700 });
    const path = join(home, '.test-product', 'settings.json');
    writeFileSync(path, '');
    const ctx = (terminal: ReturnType<typeof createCapturingTerminal>['terminal']) => ({
      version: '0.0.0-test',
      terminal,
      cwd: home,
      options: {
        productRuntime: createTestProductRuntime('test-product', { HOME: home }),
        providerDefinitions: definitions,
        projectAccess: createRestrictedWorkspaceProjectAccess('untrusted', home),
      },
      isTTY: false,
      env: {},
      userHome: home,
    });
    const refused = createCapturingTerminal();
    expect(await runDoctorRoute(ctx(refused.terminal), ['--repair', 'settings.user.test-product'])).toBe(
      1,
    );
    expect(refused.errors.join('\n')).toContain('--yes');
    expect(readFileSync(path, 'utf8')).toBe('');

    const applied = createCapturingTerminal();
    const code = await runDoctorRoute(ctx(applied.terminal), [
      '--repair',
      'settings.user.test-product',
      '--yes',
    ]);
    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual({});
    expect(applied.lines.join('\n')).toContain('[settings.user.test-product] ok');
    expect(code).toBe(1); // still no provider configured

    const again = createCapturingTerminal();
    expect(
      await runDoctorRoute(ctx(again.terminal), ['--repair', 'settings.user.test-product', '--yes']),
    ).toBe(1);
    expect(again.errors.join('\n')).toContain('state is ok');
  });

  it('turns a workspace-composition throw into a fail check instead of crashing', () => {
    const home = isolatedHome();
    const inputs = buildDoctorInputs({
      cwd: home,
      version: '0.0.0-test',
      options: {productRuntime: createTestProductRuntime('test-product', { HOME: home }),  projectSettingsWriter: {} as never },
      projectAccess: createRestrictedWorkspaceProjectAccess('untrusted', home),
      providerDefinitions: definitions,
      env: {},
      userHome: home,
    });
    expect(inputs.compositionFailure).toMatchObject({
      id: 'workspace.composition',
      status: 'fail',
    });
    expect(inputs.compositionFailure?.cause).toContain('WorkspaceAuthorityRequiredError');
    expect(inputs.settingsSources.length).toBe(2);
  });

  it('reports only user plugin scope for a restricted workspace', () => {
    const home = isolatedHome();
    const project = isolatedHome();
    const inputs = buildDoctorInputs({
      cwd: project,
      version: '0.0.0-test',
      options: {productRuntime: createTestProductRuntime('test-product', { HOME: home }), },
      projectAccess: createRestrictedWorkspaceProjectAccess('untrusted', project),
      providerDefinitions: definitions,
      env: {},
      userHome: home,
    });

    expect(inputs.pluginsDirs).toEqual([join(home, '.test-product', 'plugins')]);
  });
});
