import { createRequire } from 'node:module';
import { afterEach, describe, expect, it } from 'vitest';
import { OrganizationLedger } from '../index.js';
import type { ISqlModule } from '../sql.js';
import { fixture } from './fixtures.js';

const fixtures: ReturnType<typeof fixture>[] = [];
afterEach(() => {
  for (const f of fixtures.splice(0)) f.cleanup();
});

function legacy(f: ReturnType<typeof fixture>, corrupt = false): void {
  f.ledger.close();
  const sqlite = createRequire(import.meta.url)('node:sqlite') as ISqlModule;
  const database = new sqlite.DatabaseSync(f.path, {
    allowExtension: false,
    enableDoubleQuotedStringLiterals: false,
  });
  database.exec(
    'DROP TABLE git_intents; DROP TABLE state_effects; DROP TABLE shared_state; UPDATE metadata SET version=1 WHERE id=1;',
  );
  if (corrupt) database.exec('UPDATE metadata SET version=99 WHERE id=1;');
  database.close();
}

describe('explicit owner schema upgrade', () => {
  it('preserves spent/held accounting, completed receipts, replay and used approvals from the v1 journal', () => {
    const f = fixture();
    fixtures.push(f);
    const completed = f.request();
    const approval = f.approval(completed);
    f.ledger.reserve(
      f.call(completed).request,
      { tokens: 5, timeMs: 100, costMicros: 5 },
      approval,
      true,
    );
    f.ledger.settle(completed, {
      value: { committed: true },
      usage: { tokens: 2, timeMs: 1, costMicros: 2 },
    });
    const pending = f.request();
    f.ledger.reserve(
      f.call(pending).request,
      { tokens: 10, timeMs: 100, costMicros: 10 },
      null,
      false,
    );
    const before = f.ledger.budgetState('global');
    legacy(f);
    expect(() => new OrganizationLedger(f.ledgerOptions)).toThrow('policy-unavailable');
    const upgraded = new OrganizationLedger({
      ...f.ledgerOptions,
      upgrade: true,
    });
    expect(upgraded.budgetState('global')).toEqual(before);
    expect(() =>
      upgraded.reserve(
        f.call(completed).request,
        { tokens: 5, timeMs: 100, costMicros: 5 },
        null,
        false,
      ),
    ).toThrow('replayed');
    const cached = upgraded.reserve(
      f.call({ ...completed, nonce: 'fresh' }).request,
      { tokens: 5, timeMs: 100, costMicros: 5 },
      null,
      true,
    );
    expect(cached.kind).toBe('complete');
    if (cached.kind === 'complete') expect(cached.receipt.value).toEqual({ committed: true });
    expect(() =>
      upgraded.reserve(
        f.call({ ...pending, nonce: 'fresh-pending' }).request,
        { tokens: 5, timeMs: 100, costMicros: 5 },
        null,
        false,
      ),
    ).toThrow('operation-pending');
    const other = f.request();
    expect(() =>
      upgraded.reserve(
        f.call(other).request,
        { tokens: 5, timeMs: 100, costMicros: 5 },
        f.approval(other, { id: approval.claims.id }),
        true,
      ),
    ).toThrow('approval-reused');
    upgraded.close();
    const reopened = new OrganizationLedger(f.ledgerOptions);
    expect(reopened.budgetState('global')).toEqual(before);
    reopened.close();
  });

  it('upgrades an existing v2 journal without replacing fenced state or held reservations', async () => {
    const f = fixture();
    fixtures.push(f);
    f.ledger.createStateResource('company', 'task', 'board', { oid: 'old' });
    const pending = f.request();
    f.ledger.reserve(
      f.call(pending).request,
      { tokens: 1, timeMs: 100, costMicros: 1 },
      null,
      false,
    );
    const before = f.ledger.budgetState('global');
    f.ledger.close();
    const sqlite = createRequire(import.meta.url)('node:sqlite') as ISqlModule;
    const database = new sqlite.DatabaseSync(f.path, {
      allowExtension: false,
      enableDoubleQuotedStringLiterals: false,
    });
    database.exec('DROP TABLE git_intents; UPDATE metadata SET version=2 WHERE id=1;');
    database.close();
    expect(() => new OrganizationLedger(f.ledgerOptions)).toThrow('policy-unavailable');
    const upgraded = new OrganizationLedger({ ...f.ledgerOptions, upgrade: true });
    expect(upgraded.budgetState('global')).toEqual(before);
    expect(() =>
      upgraded.createStateResource('company', 'task', 'board', { oid: 'reset' }),
    ).toThrow('operation-conflict');
    expect(() =>
      upgraded.reserve(
        f.call({ ...pending, nonce: 'after-v2-upgrade' }).request,
        { tokens: 1, timeMs: 100, costMicros: 1 },
        null,
        false,
      ),
    ).toThrow('operation-pending');
    upgraded.close();
  });

  it('preserves task stop/revocation and refuses unknown schema versions even with upgrade enabled', async () => {
    const f = fixture();
    fixtures.push(f);
    f.ledger.stopTask('company', 'task');
    f.ledger.revokeGrant('root');
    legacy(f);
    const upgraded = new OrganizationLedger({
      ...f.ledgerOptions,
      upgrade: true,
    });
    expect(upgraded.budgetState('task', 'company', 'task').stopped).toBe(true);
    expect(() => upgraded.authenticate(f.call(f.request()).request)).toThrow('revoked');
    upgraded.close();
    const g = fixture();
    fixtures.push(g);
    legacy(g, true);
    expect(() => new OrganizationLedger({ ...g.ledgerOptions, upgrade: true })).toThrow(
      'policy-unavailable',
    );
  });
});
