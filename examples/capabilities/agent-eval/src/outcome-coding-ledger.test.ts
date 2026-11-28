import assert from 'node:assert/strict';
import {
  appendFileSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import {
  DEFAULT_CALL_CAP,
  DEFAULT_CEILING_MICROS,
  LedgerError,
  SpendLedger,
  type ILedgerHeader,
} from './outcome-coding-ledger.js';

function header(patch: Partial<ILedgerHeader> = {}): ILedgerHeader {
  return {
    ceilingMicros: 1_000,
    callCap: 5,
    basis: { promptMicrosPerMillionTokens: 1_000_000, completionMicrosPerMillionTokens: 2_000_000 },
    commit: 'abc123',
    route: { provider: 'route-a', model: 'pinned-model' },
    maxOutputTokens: 100,
    templateAllowanceTokens: 10,
    ...patch,
  };
}

// 100 input tokens (90 bytes plus the allowance) at 1 micro each plus 100 output tokens at 2 micro.
const REQUEST = { requestBytes: 90, maxOutputTokens: 100 };
const RESERVATION = 300;

function withDir(run: (dir: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), 'ledger-test-'));
  try {
    run(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function refusal(action: () => unknown): string {
  try {
    action();
  } catch (error) {
    assert.ok(error instanceof LedgerError, String(error));
    return error.code;
  }
  return assert.fail('expected a ledger error');
}

test('the defaults do not exceed the approved ceiling', () => {
  assert.ok(DEFAULT_CEILING_MICROS <= 2_000_000);
  assert.ok(DEFAULT_CALL_CAP > 0);
});

test('admission reserves the maximum cost durably and the receipt swaps in the real cost', () => {
  withDir((dir) => {
    const path = join(dir, 'ledger.jsonl');
    const ledger = SpendLedger.create(path, header());
    const admitted = ledger.admit(REQUEST);
    assert.deepEqual(admitted, { ok: true, id: 1, reservedMicros: RESERVATION });
    assert.equal(ledger.state().committedMicros, RESERVATION);
    // The reservation is on disk before the call can leave.
    assert.equal(readFileSync(path, 'utf8').trim().split('\n').length, 2);
    assert.deepEqual(ledger.settle(1, { costMicros: 40, outputTokens: 7 }), { overrun: false });
    assert.equal(ledger.state().committedMicros, 40);
    assert.equal(ledger.state().settledMicros, 40);
    ledger.close();
  });
});

test('a call without a receipt keeps its reservation across a reopen', () => {
  withDir((dir) => {
    const path = join(dir, 'ledger.jsonl');
    const first = SpendLedger.create(path, header());
    first.admit(REQUEST);
    first.admit(REQUEST);
    first.settle(2, { costMicros: 10 });
    first.close();
    const reopened = SpendLedger.open(path);
    assert.deepEqual(reopened.state().unsettledIds, [1]);
    assert.equal(reopened.state().committedMicros, RESERVATION + 10);
    reopened.close();
  });
});

test('admission refuses past the call cap', () => {
  withDir((dir) => {
    const ledger = SpendLedger.create(
      join(dir, 'l.jsonl'),
      header({ callCap: 2, ceilingMicros: 10_000 }),
    );
    for (const id of [1, 2]) {
      assert.equal(ledger.admit(REQUEST).ok, true);
      ledger.settle(id, { costMicros: 1 });
    }
    const third = ledger.admit(REQUEST);
    assert.equal(third.ok ? '' : third.code, 'cap');
    assert.equal(ledger.state().remainingCalls, 0);
    ledger.close();
  });
});

test('admission refuses one micro-dollar over the ceiling and admits exactly at it', () => {
  withDir((dir) => {
    const atCeiling = SpendLedger.create(
      join(dir, 'a.jsonl'),
      header({ ceilingMicros: RESERVATION }),
    );
    assert.equal(atCeiling.admit(REQUEST).ok, true);
    atCeiling.close();
    const over = SpendLedger.create(
      join(dir, 'b.jsonl'),
      header({ ceilingMicros: RESERVATION - 1 }),
    );
    const refused = over.admit(REQUEST);
    assert.equal(refused.ok ? '' : refused.code, 'ceiling');
    assert.equal(over.state().callsAdmitted, 0);
    over.close();
    // A larger output cap than the header allows is refused as well.
    const capped = SpendLedger.create(join(dir, 'c.jsonl'), header());
    const tooMuch = capped.admit({ requestBytes: 1, maxOutputTokens: 101 });
    assert.equal(tooMuch.ok ? '' : tooMuch.code, 'output-cap');
    capped.close();
  });
});

test('a reservation counts against the ceiling until it is settled', () => {
  withDir((dir) => {
    const ledger = SpendLedger.create(
      join(dir, 'l.jsonl'),
      header({ ceilingMicros: RESERVATION * 2 }),
    );
    assert.equal(ledger.admit(REQUEST).ok, true);
    assert.equal(ledger.admit(REQUEST).ok, true);
    assert.equal(ledger.admit(REQUEST).ok, false);
    ledger.settle(1, { costMicros: 0 });
    assert.equal(ledger.admit(REQUEST).ok, true);
    ledger.close();
  });
});

test('a receipt above its reservation is recorded in full against the ceiling and stops the run', () => {
  withDir((dir) => {
    const ledger = SpendLedger.create(join(dir, 'l.jsonl'), header({ ceilingMicros: 1_000 }));
    ledger.admit(REQUEST);
    assert.deepEqual(ledger.settle(1, { costMicros: 900 }), { overrun: true });
    assert.equal(ledger.state().committedMicros, 900);
    assert.match(ledger.state().stopReason ?? '', /more than its reservation/);
    const refused = ledger.admit({ requestBytes: 1, maxOutputTokens: 1 });
    assert.equal(refused.ok ? '' : refused.code, 'stopped');
    ledger.close();
  });
});

test('the header cannot change: re-creation, a different expected header and an edit are all refused', () => {
  withDir((dir) => {
    const path = join(dir, 'ledger.jsonl');
    SpendLedger.create(path, header()).close();
    assert.equal(
      refusal(() => SpendLedger.create(path, header({ ceilingMicros: 999_999 }))),
      'exists',
    );
    assert.equal(
      refusal(() => SpendLedger.open(path, { expectedHeader: header({ callCap: 800 }) })),
      'header-mismatch',
    );
    SpendLedger.open(path, { expectedHeader: header() }).close();
    // An edited header is refused by the run's expected header...
    const original = readFileSync(path, 'utf8');
    writeFileSync(path, original.replace('"ceilingMicros":1000', '"ceilingMicros":9999999'));
    assert.equal(
      refusal(() => SpendLedger.open(path, { expectedHeader: header() })),
      'header-mismatch',
    );
    // ...and, once any entry follows it, by the hash chain alone.
    writeFileSync(path, original);
    const ledger = SpendLedger.open(path);
    ledger.admit(REQUEST);
    ledger.close();
    const grown = readFileSync(path, 'utf8');
    writeFileSync(path, grown.replace('"ceilingMicros":1000', '"ceilingMicros":9999999'));
    assert.equal(
      refusal(() => SpendLedger.open(path)),
      'corrupt',
    );
  });
});

test('a torn tail is refused and never truncated', () => {
  withDir((dir) => {
    const path = join(dir, 'ledger.jsonl');
    const ledger = SpendLedger.create(path, header());
    ledger.admit(REQUEST);
    ledger.close();
    appendFileSync(path, '{"seq":2,"prev":"abc","type":"sett');
    const size = statSync(path).size;
    const before = readFileSync(path);
    assert.equal(
      refusal(() => SpendLedger.open(path)),
      'torn-tail',
    );
    assert.equal(statSync(path).size, size);
    assert.deepEqual(readFileSync(path), before);
    assert.equal(existsSync(`${path}.lock`), false);
  });
});

test('a missing, reordered or dropped line is refused', () => {
  withDir((dir) => {
    const path = join(dir, 'ledger.jsonl');
    const ledger = SpendLedger.create(path, header({ ceilingMicros: 100_000 }));
    for (const id of [1, 2, 3]) {
      ledger.admit(REQUEST);
      ledger.settle(id, { costMicros: 5 });
    }
    ledger.close();
    const lines = readFileSync(path, 'utf8').trim().split('\n');
    writeFileSync(path, `${[...lines.slice(0, 2), ...lines.slice(3)].join('\n')}\n`);
    assert.equal(
      refusal(() => SpendLedger.open(path)),
      'corrupt',
    );
    writeFileSync(path, `${[lines[0], lines[2], lines[1], ...lines.slice(3)].join('\n')}\n`);
    assert.equal(
      refusal(() => SpendLedger.open(path)),
      'corrupt',
    );
    assert.equal(
      refusal(() => SpendLedger.open(join(dir, 'absent.jsonl'))),
      'missing',
    );
  });
});

test('unsettled calls from an earlier process block admission until each is reconciled', () => {
  withDir((dir) => {
    const path = join(dir, 'ledger.jsonl');
    const first = SpendLedger.create(path, header({ ceilingMicros: 100_000 }));
    first.admit(REQUEST);
    first.admit(REQUEST);
    first.close();
    const second = SpendLedger.open(path);
    const blocked = second.admit(REQUEST);
    assert.equal(blocked.ok ? '' : blocked.code, 'unreconciled');
    second.reconcile(1, { costMicros: 30, reason: 'provider record checked' });
    assert.equal(second.admit(REQUEST).ok, false);
    second.reconcile(2, { reason: 'no record; the reservation stands' });
    assert.equal(second.state().settledMicros, 30 + RESERVATION);
    assert.equal(second.admit(REQUEST).ok, true);
    assert.equal(
      refusal(() => second.reconcile(1, { reason: 'again' })),
      'already-settled',
    );
    assert.equal(
      refusal(() => second.reconcile(99, { reason: 'x' })),
      'unknown-entry',
    );
    second.close();
  });
});

test('a stop persists, resume needs every call settled, and a resumed ledger admits again', () => {
  withDir((dir) => {
    const path = join(dir, 'ledger.jsonl');
    const ledger = SpendLedger.create(path, header({ ceilingMicros: 100_000 }));
    assert.equal(
      refusal(() => ledger.resume('no stop')),
      'not-stopped',
    );
    ledger.admit(REQUEST);
    ledger.stop('call 1 got no answer');
    ledger.stop('a second reason is ignored');
    assert.equal(ledger.state().stopReason, 'call 1 got no answer');
    ledger.close();
    const reopened = SpendLedger.open(path);
    assert.equal(reopened.state().stopReason, 'call 1 got no answer');
    assert.equal(
      refusal(() => reopened.resume('too early')),
      'unsettled',
    );
    reopened.reconcile(1, { reason: 'checked' });
    reopened.resume('the provider record was checked');
    assert.equal(reopened.admit(REQUEST).ok, true);
    reopened.close();
    const again = SpendLedger.open(path);
    assert.equal(again.state().stopReason, undefined);
    again.close();
  });
});

test('only one process may hold a ledger, and a header with a bad value is refused', () => {
  withDir((dir) => {
    const path = join(dir, 'ledger.jsonl');
    const ledger = SpendLedger.create(path, header());
    assert.equal(
      refusal(() => SpendLedger.open(path)),
      'locked',
    );
    ledger.close();
    SpendLedger.open(path).close();
    for (const patch of [
      { ceilingMicros: 0 },
      { callCap: 1.5 },
      { commit: '' },
      { maxOutputTokens: -1 },
      { route: { provider: '', model: 'm' } },
      { basis: { promptMicrosPerMillionTokens: 0, completionMicrosPerMillionTokens: 1 } },
    ]) {
      assert.equal(
        refusal(() => SpendLedger.create(join(dir, 'bad.jsonl'), header(patch))),
        'invalid-header',
      );
    }
    assert.equal(existsSync(join(dir, 'bad.jsonl')), false);
  });
});
