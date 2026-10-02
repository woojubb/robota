import { afterEach, describe, expect, it, vi } from 'vitest';
import { OrganizationBroker } from '../index.js';
import { fixture } from './fixtures.js';

const fixtures: ReturnType<typeof fixture>[] = [];
const brokers: OrganizationBroker[] = [];
function setup() {
  const f = fixture();
  fixtures.push(f);
  return f;
}
function broker(
  f: ReturnType<typeof fixture>,
  record: ReturnType<typeof vi.fn>,
  execute: ReturnType<typeof vi.fn>,
  timeMs = 1000,
) {
  const result = new OrganizationBroker({
    ledger: f.ledger,
    policyIntervalMs: 5,
    audit: { record },
    actions: [
      {
        resource: 'asset',
        operation: 'read',
        roles: ['operator'],
        requiresApproval: false,
        reserve: () => ({ tokens: 10, timeMs, costMicros: 10 }),
        execute,
      },
    ],
  } as never);
  brokers.push(result);
  return result;
}
afterEach(() => {
  for (const b of brokers.splice(0)) b.close();
  for (const f of fixtures.splice(0)) f.cleanup();
});

describe('independent audit dispatch gate', () => {
  it('withholds an effect and its reservation when audit persistence cannot be confirmed', async () => {
    const f = setup();
    const execute = vi.fn(async () => ({
      value: 'done',
      usage: { tokens: 1, timeMs: 0, costMicros: 1 },
    }));
    const record = vi.fn(async () => {
      throw new Error('audit unavailable');
    });
    const b = broker(f, record, execute);
    const request = f.request({
      operation: { ...f.request().operation, parameters: { secret: 'SECRET_CANARY_WRITER' } },
    });
    await expect(b.apply(f.call(request))).rejects.toThrow('outcome-unknown');
    expect(execute).not.toHaveBeenCalled();
    expect(record).toHaveBeenCalled();
    expect(JSON.stringify(record.mock.calls)).not.toContain('SECRET_CANARY_WRITER');
    expect(f.ledger.budgetState('global').held.tokens).toBe(10);
  });

  it('does not enter an effect after shutdown while a late audit acknowledgement arrives', async () => {
    const f = setup();
    let acknowledge!: () => void;
    const record = vi.fn((event) =>
      event.phase === 'dispatch'
        ? new Promise<void>((resolve) => {
            acknowledge = resolve;
          })
        : Promise.resolve(),
    );
    const execute = vi.fn(async () => ({
      value: 'done',
      usage: { tokens: 1, timeMs: 0, costMicros: 1 },
    }));
    const b = broker(f, record, execute);
    const request = b.apply(f.call(f.request()));
    const outcome = request.then(
      () => 'unexpected completion',
      () => 'outcome-unknown',
    );
    await new Promise<void>((resolve) => setImmediate(resolve));
    b.close();
    acknowledge?.();
    expect(await outcome).toBe('outcome-unknown');
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(execute).not.toHaveBeenCalled();
    expect(f.ledger.budgetState('global').held.tokens).toBe(10);
  });

  it('retains an executed effect as unknown when completion audit cannot be confirmed', async () => {
    const f = setup();
    const execute = vi.fn(async () => ({
      value: 'done',
      usage: { tokens: 1, timeMs: 0, costMicros: 1 },
    }));
    const record = vi.fn(async (event) => {
      if (event.phase === 'complete') throw new Error('completion audit unavailable');
    });
    const b = broker(f, record, execute);
    await expect(b.apply(f.call(f.request()))).rejects.toThrow('outcome-unknown');
    expect(execute).toHaveBeenCalledTimes(1);
    expect(f.ledger.budgetState('global').held.tokens).toBe(10);
    expect(f.ledger.budgetState('global').spent.tokens).toBe(0);
  });

  it('does not dispatch when audit stalls the event loop beyond the reservation deadline', async () => {
    const f = setup();
    const execute = vi.fn(async () => ({
      value: 'done',
      usage: { tokens: 1, timeMs: 0, costMicros: 1 },
    }));
    const record = vi.fn(async (event) => {
      if (event.phase !== 'dispatch') return;
      const end = performance.now() + 10;
      while (performance.now() < end) {
        /* Simulate a trusted transport callback stalling timers. */
      }
    });
    const b = broker(f, record, execute, 1);
    await expect(b.apply(f.call(f.request()))).rejects.toThrow('outcome-unknown');
    expect(execute).not.toHaveBeenCalled();
    expect(f.ledger.budgetState('global').held.tokens).toBe(10);
  });
});
