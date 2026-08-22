import { describe, expect, it } from 'vitest';

import { makeTemp } from './make-temp.mjs';

import {
  analyzeChangeset,
  findContractDispositionFindings,
  readExamined,
} from '../check-contract-disposition.mjs';

/**
 * The incident this check exists to catch, in the shape it shipped: a changeset labelling a
 * carried-but-not-honored field a "dead contract field".
 */
const INCIDENT = [
  '---',
  "'@robota-sdk/agent-core': patch",
  '---',
  '',
  '**Removes a dead contract field.**',
  '',
  '`providerProfile` is a dead contract field — nothing reads it, so it is removed.',
].join('\n');

describe('check-contract-disposition (HARNESS-097) — RED direction', () => {
  it('fails the recorded incident: a dead-contract claim with no disposition', () => {
    expect(analyzeChangeset(INCIDENT)).toHaveLength(1);
  });

  it('fails each dead-claim phrasing the guard names', () => {
    for (const body of [
      'the option is dead, so it goes',
      'removed as unused',
      'this unused public export is deleted',
      'a dead surface with no callers',
    ]) {
      expect(analyzeChangeset(body).length, body).toBe(1);
    }
  });
});

describe('check-contract-disposition (HARNESS-097) — GREEN direction', () => {
  it('passes the same incident once the real disposition is named', () => {
    const corrected = INCIDENT.replace(
      '`providerProfile` is a dead contract field — nothing reads it, so it is removed.',
      '`providerProfile` is carried-but-not-honored: it is threaded through and then ignored. ARCH-021 is the item that honors it, so the disposition here is keep-and-document, not removal.',
    );
    expect(analyzeChangeset(corrected)).toHaveLength(0);
  });

  it('passes a removal that records it as a product decision', () => {
    expect(
      analyzeChangeset('Removed as unused, by explicit product decision after the owner chose it.'),
    ).toHaveLength(0);
  });

  it('passes a relocation', () => {
    expect(
      analyzeChangeset('The field looked dead; it was misplaced. Relocated to its real owner.'),
    ).toHaveLength(0);
  });

  it('passes ordinary changeset prose that makes no claim about a contract', () => {
    for (const body of [
      'Fixes a crash when the provider returns an empty response.',
      'Removed the unused import left behind by the previous refactor.',
      'Adds a forward-provisioned surface for the upcoming transport.',
      // The false positive the first draft of this guard actually produced, against a real
      // changeset: an unreachable branch is not an unconsumed contract.
      "`resolveExecArgv`'s `--import tsx` branch was therefore dead code.",
    ]) {
      expect(analyzeChangeset(body), body).toHaveLength(0);
    }
  });
});

describe('check-contract-disposition (HARNESS-097) — the real tree', () => {
  it('walks the repository changesets and reports what it examined', () => {
    const findings = findContractDispositionFindings();
    expect(Array.isArray(findings)).toBe(true);
  });

  it('counts exactly what it examined, and RESETS between runs', async () => {
    const { writeFile } = await import('node:fs/promises');
    const path = (await import('node:path')).default;

    const two = makeTemp('robota-cd-');
    await writeFile(path.join(two, 'a.md'), 'ordinary prose', 'utf8');
    await writeFile(path.join(two, 'b.md'), 'more prose', 'utf8');
    findContractDispositionFindings(two);
    expect(readExamined()).toBe(2);

    const one = makeTemp('robota-cd-');
    await writeFile(path.join(one, 'only.md'), 'prose', 'utf8');
    findContractDispositionFindings(one);
    expect(readExamined()).toBe(1);
  });
});
