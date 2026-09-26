import {
  closeSync,
  fstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createExternalEventAuditRing } from '../external-event-audit-ring.js';

import type { TExternalEventAuditRecord } from '@robota-sdk/agent-interface-transport';

const ID = '0f6c3a5e-8c1b-4d2a-9f3e-1a2b3c4d5e6f';

/** The permission bits and text of one file, both taken from the same open descriptor. */
function readTrail(file: string): { mode: number; text: string } {
  const fd = openSync(file, 'r');
  try {
    return { mode: fstatSync(fd).mode & 0o777, text: readFileSync(fd, 'utf8') };
  } finally {
    closeSync(fd);
  }
}

describe('external event audit ring', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'rs-audit-'));
    mkdirSync(join(dir, 'audit'), { mode: 0o700 });
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('appends content-free JSONL records to an owner-only file', () => {
    const write = createExternalEventAuditRing(join(dir, 'audit'), ID);
    write({ at: 't1', grantId: 'ci', refusal: 'expired', remote: 'public', throttled: false });
    write({ at: 't2', grantId: 'ci', settlement: 'completed' });
    const extra = {
      at: 't3',
      refusal: 'unknown-grant',
      token: 'SECRET',
      content: 'TEXT',
    } as unknown as TExternalEventAuditRecord;
    write(extra);
    const trail = readTrail(join(dir, 'audit', `${ID}.jsonl`));
    expect(trail.mode).toBe(0o600);
    const records = trail.text
      .trim()
      .split('\n')
      .map((text) => JSON.parse(text) as unknown);
    expect(records).toEqual([
      { at: 't1', grantId: 'ci', refusal: 'expired', remote: 'public', throttled: false },
      { at: 't2', grantId: 'ci', settlement: 'completed' },
      { at: 't3', refusal: 'unknown-grant' },
    ]);
  });

  it('rotates to one previous file, so one session holds a bounded trail', () => {
    const write = createExternalEventAuditRing(join(dir, 'audit'), ID);
    for (let index = 0; index < 6000; index += 1) {
      write({
        at: new Date(index).toISOString(),
        grantId: 'ci',
        refusal: 'bad-signature',
        remote: 'public',
        throttled: true,
      });
    }
    const names = readdirSync(join(dir, 'audit')).sort();
    expect(names).toEqual([`${ID}.1.jsonl`, `${ID}.jsonl`]);
    for (const name of names)
      expect(statSync(join(dir, 'audit', name)).size).toBeLessThanOrEqual(256 * 1024);
    // Both files stay owner-only, and the trail continues where the previous file stops.
    const previous = readTrail(join(dir, 'audit', `${ID}.1.jsonl`));
    const current = readTrail(join(dir, 'audit', `${ID}.jsonl`));
    expect([previous.mode, current.mode]).toEqual([0o600, 0o600]);
    const at = (text: string): string[] =>
      text
        .trim()
        .split('\n')
        .map((entry) => (JSON.parse(entry) as { at: string }).at);
    const lastPrevious = at(previous.text).at(-1) ?? '';
    const firstCurrent = at(current.text)[0] ?? '';
    expect(Date.parse(firstCurrent) - Date.parse(lastPrevious)).toBe(1);
    expect(at(current.text).at(-1)).toBe(new Date(5999).toISOString());
  });

  it('replaces a link planted at the previous file instead of writing through it', () => {
    const audit = join(dir, 'audit');
    const victim = join(dir, 'victim.txt');
    writeFileSync(victim, 'untouched');
    symlinkSync(victim, join(audit, `${ID}.1.jsonl`));
    const write = createExternalEventAuditRing(audit, ID);
    for (let index = 0; index < 4000; index += 1) {
      write({ at: new Date(index).toISOString(), grantId: 'ci', refusal: 'bad-signature' });
    }
    expect(readFileSync(victim, 'utf8')).toBe('untouched');
    expect(readTrail(join(audit, `${ID}.1.jsonl`)).mode).toBe(0o600);
  });

  it('removes the oldest trails beyond its bound when a new session opens one', () => {
    const audit = join(dir, 'audit');
    for (let index = 0; index < 70; index += 1) {
      const file = join(audit, `old-${String(index).padStart(2, '0')}.jsonl`);
      writeFileSync(file, '{}\n', { mode: 0o600 });
      utimesSync(file, index, index);
    }
    createExternalEventAuditRing(audit, ID);
    const names = readdirSync(audit);
    expect(names).toHaveLength(64);
    expect(names).not.toContain('old-00.jsonl');
    expect(names).toContain('old-69.jsonl');
  });

  it('never throws, even when the trail cannot be written', () => {
    const write = createExternalEventAuditRing(join(dir, 'missing'), ID);
    expect(() => write({ at: 't', refusal: 'expired' })).not.toThrow();
  });
});
