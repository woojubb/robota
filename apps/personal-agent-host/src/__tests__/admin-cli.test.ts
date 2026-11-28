import { afterEach, describe, expect, it } from 'vitest';

import type { IAccountView, IStatusReport } from '../control-plane.js';
import { FakeRuntime } from '../runtime/fake.js';
import type { IUnitSecrets, IUnitSpec, IUnitStatus } from '../runtime/port.js';
import { cleanTempDirs, KEY } from './harness.js';
import {
  JSON_HEADERS,
  rawRequest,
  runCli,
  startHost,
  stopHosts,
  ttyStdin,
  type ITestHost,
} from './admin-harness.js';

afterEach(async () => {
  await stopHosts();
  await cleanTempDirs();
});

const ADD = ['add', 'vera', '--provider', 'anthropic', '--model', 'test-model'];

async function everything(host: ITestHost, extra: string[] = []): Promise<string> {
  return [...host.seen, await host.audit(), ...extra].join('\n');
}

describe('the CLI against a running serve', () => {
  it('runs the whole lifecycle with the key on stdin', async () => {
    const host = await startHost();

    const added = await host.cli(ADD, `${KEY}\n`);
    expect(added).toMatchObject({ code: 0, err: '' });
    expect(added.out).toContain('https://vera.agents.example.test');
    expect(added.out).toContain('active');
    expect(host.runtime.wasStartedWithKey('vera', KEY)).toBe(true);

    const list = await host.cli(['list']);
    expect(list.code).toBe(0);
    expect(list.out).toMatch(/vera\s+active\s+running\s+set\s+[a-f0-9]{12}\s+https:\/\/vera/u);

    const show = await host.cli(['show', 'vera']);
    expect(show.out).toMatch(/provider\s+anthropic test-model/u);
    expect(show.out).toMatch(/key\s+account \(set\)/u);

    const status = await host.cli(['status']);
    expect(status.out).toMatch(/guard\s+verified/u);
    expect(status.out).toMatch(/vera\s+active\s+running\s+yes/u);

    const suspended = await host.cli(['suspend', 'vera']);
    expect(suspended.out).toContain('suspended');
    expect(host.runtime.wasStartedWithKey('vera', KEY)).toBe(false);

    const resumed = await host.cli(['resume', 'vera']);
    expect(resumed.out).toContain('active');
    expect(host.runtime.wasStartedWithKey('vera', KEY)).toBe(true);

    const code = await host.cli(['access-code', 'vera']);
    expect(code.code).toBe(0);
    expect(code.out).toMatch(/^[A-Za-z0-9_-]{16}\n$/u);

    const deleted = await host.cli(['delete', 'vera', '--confirm', 'vera']);
    expect(deleted).toMatchObject({ code: 0, out: 'Deleted vera\n' });
    expect(host.runtime.has('vera')).toBe(false);
    expect((await host.cli(['list'])).out).toBe('No accounts.\n');
  });

  it('prints machine-readable results with --json', async () => {
    const host = await startHost();
    await host.cli(ADD, KEY);
    const list = JSON.parse((await host.cli(['list', '--json'])).out) as IAccountView[];
    expect(list.map((v) => [v.id, v.key])).toEqual([['vera', 'set']]);
    const status = JSON.parse((await host.cli(['status', '--json'])).out) as IStatusReport;
    expect(status.accounts).toEqual([
      {
        id: 'vera',
        desired: 'active',
        actual: 'running',
        healthy: true,
        imageId: expect.stringMatching(/^sha256:[a-f0-9]{64}$/u),
        lastRestartAt: null,
        backoff: null,
      },
    ]);
    expect(status.domainMismatches).toEqual([]);
  });

  it('accepts a key source without a key, and never reads stdin for it', async () => {
    const host = await startHost();
    const result = await host.cli([...ADD, '--key-source', 'none']);
    expect(result.code).toBe(0);
    expect(host.runtime.wasStartedWithKey('vera', KEY)).toBe(false);
  });

  it('passes limits and a base URL through', async () => {
    const host = await startHost();
    const added = await host.cli(
      [
        ...ADD,
        '--base-url',
        'https://llm.example.test/v1',
        '--memory-mb',
        '512',
        '--cpus',
        '0.5',
        '--pids',
        '64',
      ],
      KEY,
    );
    expect(added.code).toBe(0);
    const show = await host.cli(['show', 'vera', '--json']);
    const view = JSON.parse(show.out) as IAccountView;
    expect(view.limits).toEqual({ memoryMb: 512, cpus: 0.5, pids: 64 });
    expect(view.provider.baseUrl).toBe('https://llm.example.test/v1');
  });

  it('asks for the key on a terminal without echoing it, and honours backspace', async () => {
    const host = await startHost();
    const stdin = ttyStdin();
    const pending = host.cli(ADD, stdin);
    await new Promise((resolve) => setTimeout(resolve, 20));
    stdin.push(`${KEY}Z`);
    stdin.push('\u007f\r');
    const result = await pending;
    expect(result.code).toBe(0);
    expect(host.runtime.wasStartedWithKey('vera', KEY)).toBe(true);
    expect(result.err).toBe('Model key (input is hidden): \n');
    expect(result.out).not.toContain(KEY);
  });

  it('asks to type the account id back on a terminal before deleting', async () => {
    const host = await startHost();
    await host.cli(ADD, KEY);
    const wrong = ttyStdin();
    const first = host.cli(['delete', 'vera'], wrong);
    await new Promise((resolve) => setTimeout(resolve, 20));
    wrong.push('veRa\n');
    expect((await first).code).toBe(3);
    expect(host.runtime.has('vera')).toBe(true);

    const right = ttyStdin();
    const second = host.cli(['delete', 'vera'], right);
    await new Promise((resolve) => setTimeout(resolve, 20));
    right.push('vera\n');
    expect((await second).code).toBe(0);
    expect(host.runtime.has('vera')).toBe(false);
  });
});

describe('typed confirmation', () => {
  it('is required: no confirmation off a terminal, a wrong one at the server', async () => {
    const host = await startHost();
    await host.cli(ADD, KEY);

    const none = await host.cli(['delete', 'vera']);
    expect(none.code).toBe(3);
    expect(none.err).toContain('--confirm vera');

    const wrong = await host.cli(['delete', 'vera', '--confirm', 'vera2']);
    expect(wrong.code).toBe(3);
    expect(wrong.err).toContain('repeat the account id');

    expect(host.runtime.has('vera')).toBe(true);
    expect(await host.audit()).toContain('"command":"delete","account":"vera","result":"refused"');
  });
});

describe('exit codes', () => {
  it('separate done, refused, missing, broken, usage and unreachable', async () => {
    const host = await startHost();
    expect((await host.cli(['list'])).code).toBe(0);
    expect((await host.cli(['show', 'nobody'])).code).toBe(4);
    expect((await host.cli(['suspend', 'nobody'])).code).toBe(4);
    await host.cli(ADD, KEY);
    expect((await host.cli(ADD, KEY)).code).toBe(3);
    expect((await host.cli(['add', 'Bad_Id', '--provider', 'anthropic'], KEY)).code).toBe(3);

    host.runtime.failNext('provision');
    expect((await host.cli(['add', 'second', '--provider', 'anthropic'], KEY)).code).toBe(1);

    expect((await host.cli([])).code).toBe(2);
    expect((await host.cli(['bogus'])).code).toBe(2);
    expect((await host.cli(['show'])).code).toBe(2);
    expect((await host.cli(['list', 'extra'])).code).toBe(2);
    expect((await host.cli(['list', '--confirm', 'x'])).code).toBe(2);
    expect((await host.cli(['add', 'x'], KEY)).code).toBe(2);
    expect((await host.cli([...ADD, '--memory-mb', 'lots'], KEY)).code).toBe(2);
    expect((await host.cli(['serve', 'now'])).code).toBe(2);
    expect((await host.cli(['upgrade'])).code).toBe(2);
    expect((await host.cli(['upgrade', 'x', '--all'])).code).toBe(2);
    expect((await host.cli(['suspend', 'x', '--all'])).code).toBe(2);

    const missing = await runCli({ ...host.env, PERSONAL_AGENT_HOST_STATE_DIR: '/tmp/pah-none' }, [
      'list',
    ]);
    expect(missing.code).toBe(5);
    expect(missing.err).toContain('is "personal-agent-host serve" running?');
  });

  it('refuses the container backend unless the setting allows it, naming the setting', async () => {
    const host = await startHost({ extra: { PERSONAL_AGENT_HOST_ALLOW_CONTAINER: 'false' } });
    const result = await host.cli(ADD, KEY);
    expect(result.code).toBe(3);
    expect(result.err).toContain('PERSONAL_AGENT_HOST_ALLOW_CONTAINER=true');
    expect(host.runtime.unitCount()).toBe(0);
  });

  it('refuses the vm backend as not yet available', async () => {
    const host = await startHost();
    const result = await host.cli([...ADD, '--backend', 'vm'], KEY);
    expect(result.code).toBe(3);
    expect(result.err).toContain('not available yet');
  });
});

describe('the model key never leaves', () => {
  it('is absent from every output, the audit log, errors and socket responses', async () => {
    const host = await startHost();
    const raw: string[] = [];

    host.runtime.failNext('start', new Error(`engine refused the key ${KEY}`));
    const failed = await host.cli(ADD, KEY);
    expect(failed.code).toBe(1);
    expect(failed.err).toContain('[redacted]');

    expect((await host.cli(ADD, KEY)).code).toBe(0);
    for (const args of [
      ['list'],
      ['show', 'vera'],
      ['status'],
      ['list', '--json'],
      ['status', '--json'],
      ['show', 'vera', '--json'],
      ['suspend', 'vera'],
      ['resume', 'vera'],
      ['access-code', 'vera'],
    ]) {
      await host.cli(args);
    }
    await host.cli(['add', 'vera', '--provider', 'anthropic'], KEY);

    for (const path of ['/v1/accounts', '/v1/accounts/vera', '/v1/status']) {
      raw.push((await rawRequest(host.env, 'GET', path)).body);
    }
    // A malformed body that happens to contain the key must not be echoed by the parser.
    const garbage = await rawRequest(
      host.env,
      'POST',
      '/v1/accounts',
      `{"apiKey":"${KEY}"`,
      JSON_HEADERS,
    );
    raw.push(garbage.body);
    expect(garbage.status).toBe(400);
    const extra = await rawRequest(
      host.env,
      'POST',
      '/v1/accounts',
      JSON.stringify({
        id: 'x',
        backend: 'container',
        provider: { type: 'a' },
        keySource: 'account',
        apiKey: KEY,
        [KEY]: 1,
      }),
      JSON_HEADERS,
    );
    raw.push(extra.body);
    expect(extra.status).toBe(400);

    const all = await everything(host, raw);
    expect(all).not.toContain(KEY);
    expect(all).not.toContain('c7e05b2a');
  });

  it('is refused as an argument, and not echoed in the refusal', async () => {
    const host = await startHost();
    for (const args of [
      [...ADD, '--api-key', KEY],
      [...ADD, `--api-key=${KEY}`],
      [...ADD, '--key', KEY],
    ]) {
      const result = await host.cli(args);
      expect(result.code).toBe(2);
      expect(result.err).toContain('never an argument');
      expect(`${result.out}${result.err}`).not.toContain(KEY);
    }
    expect(host.runtime.unitCount()).toBe(0);
  });

  it('does not read the key from the environment', async () => {
    const host = await startHost();
    const env = { ...host.env, ANTHROPIC_API_KEY: KEY, PERSONAL_AGENT_API_KEY: KEY };
    const result = await runCli(env, ADD, '');
    expect(result.code).toBe(3);
    expect(host.runtime.unitCount()).toBe(0);
  });
});

class GatedRuntime extends FakeRuntime {
  gate: Promise<void> | undefined;
  override async provision(spec: IUnitSpec): Promise<IUnitStatus> {
    await this.gate;
    return super.provision(spec);
  }
  override async start(spec: IUnitSpec, secrets: IUnitSecrets): Promise<IUnitStatus> {
    await this.gate;
    return super.start(spec, secrets);
  }
}

describe('concurrent commands', () => {
  it('run one at a time, in arrival order', async () => {
    const runtime = new GatedRuntime();
    const host = await startHost({ runtime });
    let release!: () => void;
    runtime.gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    const a = host.cli(['add', 'alpha', '--provider', 'anthropic'], KEY);
    for (let i = 0; i < 100 && !runtime.calls.includes('provision:alpha'); i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    const b = host.cli(['add', 'bravo', '--provider', 'anthropic'], KEY);
    await new Promise((resolve) => setTimeout(resolve, 30));
    const status = host.cli(['status']);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(runtime.calls.filter((c) => c.endsWith(':bravo'))).toEqual([]);

    release();
    const results = await Promise.all([a, b, status]);
    expect(results.map((r) => r.code)).toEqual([0, 0, 0]);
    const steps = runtime.calls.filter((c) => /^(provision|start):/u.test(c));
    expect(steps).toEqual(['provision:alpha', 'start:alpha', 'provision:bravo', 'start:bravo']);
    // The status command ran after both adds, so it saw both.
    expect(results[2].out).toMatch(/alpha[\s\S]*bravo/u);
  });
});

describe('upgrade from the CLI', () => {
  it('moves one account or all of them and reports what it did', async () => {
    const host = await startHost();
    await host.cli(ADD, KEY);
    await host.cli(['add', 'wren', '--provider', 'anthropic'], KEY);
    expect((await host.cli(['upgrade', 'vera'])).out).toMatch(/current\s+vera/u);

    host.runtime.rebuildImage('personal-agent:test');
    const one = await host.cli(['upgrade', 'vera', '--json']);
    expect(one.code).toBe(0);
    expect(JSON.parse(one.out).moved.map((m: { id: string }) => m.id)).toEqual(['vera']);

    const all = await host.cli(['upgrade', '--all']);
    expect(all.code).toBe(0);
    expect(all.out).toMatch(/moved\s+wren/u);
    expect(all.out).toMatch(/current\s+vera/u);
  });

  it('exits 3 for a suspended account, 4 for an unknown one and 1 after a rollback', async () => {
    const host = await startHost();
    await host.cli(ADD, KEY);
    await host.cli(['suspend', 'vera']);
    host.runtime.rebuildImage('personal-agent:test');
    const suspended = await host.cli(['upgrade', 'vera']);
    expect(suspended.code).toBe(3);
    expect(suspended.err).toContain('resume it first');
    expect((await host.cli(['upgrade', 'nobody'])).code).toBe(4);

    await host.cli(['resume', 'vera']);
    host.runtime.failNext('start', new Error('new image is broken'));
    const failed = await host.cli(['upgrade', 'vera']);
    expect(failed.code).toBe(1);
    expect(failed.err).toContain('previous image is running again');
  });
});
