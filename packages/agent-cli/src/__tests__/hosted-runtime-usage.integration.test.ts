/** Actual public CLI/worker/broker HTTP path; accounting units are synthetic, not provider charges. */
import { existsSync, readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { hostedWorkerCliFixture } from './helpers/hosted-worker-cli.js';
import { scriptedHostedBroker } from './helpers/hosted-scripted-broker.js';

it('the stock hosted CLI collects broker accounting through completion instead of zero model usage', async () => {
  const fixture = await hostedWorkerCliFixture();
  try {
    const calls = scriptedHostedBroker(fixture.f, (_body, index) => index === 0
      ? { tool: { name: 'Bash', arguments: JSON.stringify({ command: 'printf ACCOUNTED_WORK_CANARY' }) } }
      : { content: 'UNTRUSTED_WORKER_CLAIMS_ZERO_USAGE' });
    const result = await fixture.run(['-p', 'Run the accounted task', '--permission-mode', 'bypassPermissions', '--max-turns', '3', '--no-session-persistence']);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('UNTRUSTED_WORKER_CLAIMS_ZERO_USAGE');
    expect(calls).toHaveLength(2);
    const status = JSON.parse(readFileSync(fixture.usageReceipt, 'utf8')) as { state: string; usage: unknown };
    expect(status).toEqual({ state: 'stopped', usage: { sessions: 1, modelCalls: 2, modelTokens: 4, costMicros: 6 } });
    const receipts = readFileSync(fixture.receipts, 'utf8').trim().split('\n').map((line) => JSON.parse(line) as { kind?: string });
    expect(receipts.filter((receipt) => receipt.kind === 'delete')).toHaveLength(1);
  } finally { await fixture.close(); }
}, 60_000);

it('the stock hosted CLI refuses exhausted accounting before worker connection or model execution', async () => {
  const fixture = await hostedWorkerCliFixture();
  try {
    fixture.f.writeConfig({ ...fixture.f.config, lifetimeMs: 55_000,
      limits: { ...fixture.f.config.limits, modelCalls: 0 } });
    fixture.f.setUsage({ sessions: 1, modelCalls: 1, modelTokens: 2, costMicros: 3 });
    const calls = scriptedHostedBroker(fixture.f, () => ({ content: 'MUST_NOT_RUN' }));
    const result = await fixture.run(['-p', 'Run a task', '--no-session-persistence']);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('runtime usage limit exhausted');
    expect(calls).toHaveLength(0);
    expect(existsSync(fixture.receipts)).toBe(false);
    const status = JSON.parse(readFileSync(fixture.usageReceipt, 'utf8')) as { state: string; usage: unknown };
    expect(status).toEqual({ state: 'failed', usage: fixture.f.usage() });
  } finally { await fixture.close(); }
}, 60_000);
