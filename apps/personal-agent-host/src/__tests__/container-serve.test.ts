import { afterEach, describe, expect, it } from 'vitest';

import { HostError } from '../errors.js';
import { type IRunningHost, startServe } from '../serve.js';
import { hostEnv } from './admin-harness.js';
import { FakeEngine } from './fake-engine.js';
import { addInput, cleanTempDirs, KEY, tempDir } from './harness.js';

const engines: FakeEngine[] = [];
const hosts: IRunningHost[] = [];

afterEach(async () => {
  await Promise.all(hosts.splice(0).map((host) => host.stop()));
  await Promise.all(engines.splice(0).map((engine) => engine.close()));
  await cleanTempDirs();
});

async function refusal(env: NodeJS.ProcessEnv): Promise<HostError> {
  const error = await startServe(env, { log: () => undefined }).then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(HostError);
  return error as HostError;
}

async function serveOnFakeEngine(
  lines: string[] = [],
): Promise<{ engine: FakeEngine; host: IRunningHost }> {
  const engine = new FakeEngine();
  await engine.listen();
  engines.push(engine);
  const host = await startServe(
    hostEnv(await tempDir(), {
      PERSONAL_AGENT_HOST_GUARD_IMAGE: 'guard:test',
      PERSONAL_AGENT_HOST_ENGINE_ENDPOINT: engine.endpoint,
      PERSONAL_AGENT_HOST_DNS_SERVERS: '10.0.0.2, 10.0.0.3',
    }),
    { log: (line) => lines.push(line), reconcileMs: 3_600_000 },
  );
  hosts.push(host);
  return { engine, host };
}

describe('serve with the container backend', () => {
  it('refuses without the setting that says accounts are trusted, naming it', async () => {
    const dir = await tempDir();
    const error = await refusal(
      hostEnv(dir, {
        PERSONAL_AGENT_HOST_ALLOW_CONTAINER: 'false',
        PERSONAL_AGENT_HOST_GUARD_IMAGE: 'guard:test',
      }),
    );
    expect(error.code).toBe('refused');
    expect(error.message).toContain('PERSONAL_AGENT_HOST_ALLOW_CONTAINER');
    expect(error.message).toMatch(/trusted accounts/u);
  });

  it('refuses without the image that applies the guard, naming it', async () => {
    const error = await refusal(hostEnv(await tempDir()));
    expect(error.message).toContain('PERSONAL_AGENT_HOST_GUARD_IMAGE');
  });

  it('serves units on the engine behind the settings, guarded, and says who it is for', async () => {
    const lines: string[] = [];
    const { engine, host } = await serveOnFakeEngine(lines);
    expect(lines.join('\n')).toMatch(/Container backend: .*trusted people only/u);
    expect(lines.join('\n')).toContain('no proxy is configured');

    const view = await host.plane.add(addInput('alice'));
    expect(view.id).toBe('alice');
    expect(engine.containerNames()).toHaveLength(1);
    expect(engine.containerNames()[0]).toMatch(/^pah-[a-f0-9]{8}-alice$/u);
    expect(engine.guardRules).toContain('ip daddr { 10.0.0.2, 10.0.0.3 }');
    expect((await host.plane.status()).runtime.guard).toBe('verified');
    // The key went into the one unit, and nowhere in the engine's other calls.
    const carrying = engine.requests.filter((r) => JSON.stringify(r.body ?? null).includes(KEY));
    expect(carrying.map((r) => r.path)).toEqual(['/containers/create']);
  });

  it('stops every unit when the guard is lost and cannot be reapplied', async () => {
    const { engine, host } = await serveOnFakeEngine();
    await host.plane.add(addInput('alice'));
    expect(engine.containerNames()).toHaveLength(1);
    engine.flushGuard();
    engine.guardApplyFailure = { code: 1, output: 'Error: Operation not supported' };
    const report = await host.plane.reconcile();
    expect(report.guard).toBe('unverified');
    expect(report.stopped).toEqual(['alice']);
    expect(engine.containerNames()).toEqual([]);
  });

  it('reapplies a flushed guard from the reconcile loop and keeps the units running', async () => {
    const { engine, host } = await serveOnFakeEngine();
    await host.plane.add(addInput('alice'));
    engine.flushGuard();
    const report = await host.plane.reconcile();
    expect(report.guard).toBe('verified');
    expect(report.stopped).toEqual([]);
    expect(engine.guardRules).toBeDefined();
    expect(engine.containerNames()).toHaveLength(1);
  });
});
