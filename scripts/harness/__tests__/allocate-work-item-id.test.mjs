/*
 * The allocator must go RED on the condition it exists for: a number that no record file holds but
 * something in the tree already claims. That is the case that happened (INFRA-127), and it is the
 * one a survey of `.agents/tasks` cannot see.
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  RECORD_ID_WIDTH,
  SENTINEL_FLOOR,
  collectClaimed,
  idsFromIssueTitles,
  idsFromRecords,
  nextFreeId,
  positionalArgs,
  readExamined,
  recordStub,
} from '../allocate-work-item-id.mjs';
import { makeTemp } from './make-temp.mjs';

function repoWith({ records = [], files = {} }) {
  const dir = makeTemp('robota-alloc-');
  const run = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' });
  run('init', '-q', '-b', 'main');
  run('config', 'user.email', 'probe@example.invalid');
  run('config', 'user.name', 'probe');
  mkdirSync(path.join(dir, '.agents/tasks/completed'), { recursive: true });
  for (const name of records) writeFileSync(path.join(dir, '.agents/tasks', name), 'x');
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(path.join(dir, path.dirname(name)), { recursive: true });
    writeFileSync(path.join(dir, name), text);
  }
  run('add', '-A');
  run('commit', '-qm', 'fixture');
  return dir;
}

describe('the claimed set is wider than the record filenames', () => {
  it('reads an ID out of a record filename, live or completed', () => {
    const dir = repoWith({ records: ['INFRA-126-a.md', 'ARCH-FIX-020-b.md'] });
    expect(idsFromRecords(dir)).toEqual(new Set(['INFRA-126', 'ARCH-FIX-020']));
  });

  it('THE CASE THIS EXISTS FOR: a number claimed only by a citation is not free', () => {
    // Exactly what happened. `.agents/tasks` holds 126 as the highest, so counting from records
    // alone hands out 127 — which two scans already cite and no record file holds.
    const claimedFromRecordsOnly = new Set(['INFRA-125', 'INFRA-126']);
    expect(nextFreeId('INFRA', claimedFromRecordsOnly)).toBe('INFRA-127');

    const claimedIncludingCitations = new Set([...claimedFromRecordsOnly, 'INFRA-127']);
    expect(nextFreeId('INFRA', claimedIncludingCitations)).toBe('INFRA-128');
  });

  it('counts up from the highest rather than filling a gap', () => {
    // A gap is usually a number claimed by something not visible here — an unpushed branch, an
    // issue not yet opened. Handing it out is the collision again with more confidence.
    expect(nextFreeId('INFRA', new Set(['INFRA-001', 'INFRA-005']))).toBe('INFRA-006');
  });

  it('skips the fixture band instead of continuing the sequence into it', () => {
    expect(nextFreeId('INFRA', new Set(['INFRA-126', 'INFRA-999']))).toBe('INFRA-127');
    expect(SENTINEL_FLOOR).toBe(900);
  });

  it('pads to the measured record width, and a wider CITATION does not change it', () => {
    expect(nextFreeId('INFRA', new Set(['INFRA-099']))).toBe('INFRA-100');
    // Inferring the width from the claimed set let prose set it: `idsFromCitations` reads the
    // working tree of every tracked file, so a comment mentioning a four-digit form became the
    // highest claim and the next allocation came back four digits wide. The number is honoured;
    // the style it appears to imply is not.
    expect(nextFreeId('INFRA', new Set(['INFRA-0126']))).toBe('INFRA-127');
    expect(RECORD_ID_WIDTH).toBe(3);
  });

  it('starts a prefix nobody has used at 001', () => {
    expect(nextFreeId('BRANDNEW', new Set(['INFRA-126']))).toBe('BRANDNEW-001');
  });

  it('does not let one prefix advance another', () => {
    expect(nextFreeId('PEER', new Set(['INFRA-126', 'PEER-007']))).toBe('PEER-008');
  });
});

describe('the issue-title source', () => {
  it('reads every ID a title names', () => {
    expect(
      idsFromIssueTitles({ run: () => ['INFRA-126 something', 'fix ARCH-FIX-020 too'] }),
    ).toEqual(new Set(['INFRA-126', 'ARCH-FIX-020']));
  });

  it('returns null — NOT an empty set — when the source could not be read', () => {
    // The distinction the whole script turns on. An empty set says no issue claims an ID; null says
    // nobody asked. Conflating them makes an unreachable network read as a clean allocation, which
    // is the exact failure the three original collisions were.
    expect(idsFromIssueTitles({ run: () => null })).toBeNull();
  });
});

describe('the record it writes', () => {
  const stub = recordStub({ id: 'INFRA-129', title: 'a thing', today: '2026-08-22', issue: 1916 });

  it('carries every field .agents/tasks/README.md declares required', () => {
    for (const field of [
      'title:',
      'status:',
      'created:',
      'priority:',
      'urgency:',
      'area:',
      'depends_on:',
    ]) {
      expect(stub).toContain(field);
    }
  });

  it('links the issue when one is given, and omits the key when none is', () => {
    expect(stub).toContain('issue: https://github.com/woojubb/robota/issues/1916');
    expect(recordStub({ id: 'INFRA-129', title: 'a thing', today: '2026-08-22' })).not.toContain(
      'issue:',
    );
  });

  it('opens at a non-terminal status, so nothing reads it as finished work', () => {
    expect(stub).toContain('status: todo');
    expect(stub).not.toContain('completed:');
  });
});

describe('the arguments it reads', () => {
  it("does not let a flag's VALUE become part of the title", () => {
    // Found by running this script on its own record: `--issue 1916` put `1916` in the slug,
    // because filtering on a leading `--` removes the flag and leaves the number behind it.
    expect(positionalArgs(['INFRA', 'a thing', '--issue', '1916'])).toEqual(['INFRA', 'a thing']);
  });

  it('still drops a valueless flag wherever it appears', () => {
    expect(positionalArgs(['INFRA', '--dry-run', 'a thing'])).toEqual(['INFRA', 'a thing']);
  });

  it('keeps a positional that merely looks like a number', () => {
    expect(positionalArgs(['INFRA', '2026', 'plan'])).toEqual(['INFRA', '2026', 'plan']);
  });
});

describe('the reported size', () => {
  /*
   * The `::examined::` number is this script's coverage claim, so it is asserted as an output: an
   * exact value against sources of known size, again after a second union, and once where every
   * source is empty. `claimed.size` would have been the size of a Set, which swallows exactly the
   * overlap between the three sources.
   */
  const RECORDS = new Set(['INFRA-126', 'INFRA-127']);
  const CITATIONS = new Set(['INFRA-127', 'ARCH-FIX-020']); // one OVERLAPS records on purpose
  const ISSUES = new Set(['PEER-007']);

  it('counts each distinct id once across the three sources', () => {
    collectClaimed(RECORDS, CITATIONS, ISSUES);
    expect(readExamined()).toBe(4);
  });

  it('starts from zero on a second union rather than accumulating', () => {
    collectClaimed(RECORDS, CITATIONS, ISSUES);
    collectClaimed(RECORDS, CITATIONS, ISSUES);
    expect(readExamined()).toBe(4);
  });

  it('reports zero, not the previous union, when every source is empty', () => {
    collectClaimed(RECORDS, CITATIONS, ISSUES);
    collectClaimed(new Set(), new Set(), new Set());
    expect(readExamined()).toBe(0);
  });

  it('counts an unread source as contributing nothing, without dropping the others', () => {
    collectClaimed(RECORDS, CITATIONS, null);
    expect(readExamined()).toBe(3);
  });
});

describe('the write itself', () => {
  it('creates or fails in one syscall, never checks-then-writes', () => {
    // CodeQL reported `js/file-system-race` on the first push of this script: an `existsSync`
    // followed by a write is a check and a claim with a gap between them, which is the exact shape
    // the script exists to remove one level up. Asserted on the source because the property is
    // which flag the call uses, and a functional test of "it refuses an existing file" passes
    // equally well for the racy version.
    const source = readFileSync(
      path.join(import.meta.dirname, '../allocate-work-item-id.mjs'),
      'utf8',
    );
    expect(source).toContain("{ flag: 'wx' }");
    expect(source).not.toMatch(/if \(existsSync\(absolute\)\)/);
  });
});
