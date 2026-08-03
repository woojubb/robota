import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * HARNESS-068 — the package listing has one owner, and the front door kept a copy.
 *
 * `CONTRIBUTING.md` carried a second copy of the package list and it had already drifted: it named a
 * package that does not exist, and that the owning document says does not exist in as many words.
 * `check-dependency-direction.mjs` Rule 9 fails the build for exactly that mistake — in the OWNING
 * document. Its scope stopped there, so the copy was the one place the name could rot unnoticed:
 * where a rule has a mechanism, the mechanism's edge is the blind spot.
 *
 * The Task's Test Plan named this regression explicitly ("assert `CONTRIBUTING.md` contains no
 * `packages/*` enumeration, which fails today"), and deleting the list without it would leave nothing
 * to stop the list coming back — the Task's own thesis, unlearned.
 *
 * WHY ONLY THESE FOUR DOCUMENTS. A blanket rule is unworkable and measuring says so: 171 tracked
 * markdown files enumerate three or more package paths, nearly all of them dated records — completed
 * Tasks, archived audits, design documents — where a listing is history and correct as written. What
 * distinguishes these four is ROLE, not content: they are read as the CURRENT description of the
 * repository, by someone who has no way to know a fresher owner exists. A copy in a dated record
 * cannot mislead that reader; a copy here is the only kind that can.
 */
const ROOT = path.resolve(import.meta.dirname, '../../..');

/** The documents a newcomer reads as "what this repository is right now". */
const FRONT_DOOR_DOCS = ['CONTRIBUTING.md', 'README.md', 'AGENTS.md', 'CLAUDE.md'];

/** The one document that owns the listing. */
const OWNER = '.agents/project-structure.md';

/**
 * Distinct `packages/<name>` paths named in LIST or TABLE lines.
 *
 * List shape rather than any mention: prose naming two or three packages while explaining something
 * is not a copy of the listing, and a rule that could not tell them apart would be unlandable and get
 * suppressed rather than obeyed. An enumeration is a list, which is what this looks for.
 */
export function enumeratedPackages(markdown) {
  const names = new Set();
  for (const line of markdown.split('\n')) {
    if (!/^\s*[-*|]/.test(line)) continue;
    for (const match of line.matchAll(/\bpackages\/([a-z0-9][a-z0-9-]*)\b/g)) names.add(match[1]);
  }
  return names;
}

/** Three is a listing; one or two is an example. */
const ENUMERATION_THRESHOLD = 3;

describe('the package list has one owner (HARNESS-068)', () => {
  for (const doc of FRONT_DOOR_DOCS) {
    it(`${doc} links to the owner instead of copying the list`, () => {
      const names = enumeratedPackages(readFileSync(path.join(ROOT, doc), 'utf8'));
      expect(
        [...names],
        `${doc} enumerates ${names.size} package paths. Link to ${OWNER} instead — a second copy ` +
          'drifts, and the rule that catches a bad package name reaches only the owning document.',
      ).toHaveLength(0);
    });
  }

  it('the owner still enumerates — otherwise this passes because nothing lists anything', () => {
    // The failure mode of the check itself. If the listing moved and this file was not updated, every
    // case above would go green over a rule that governs nothing.
    const names = enumeratedPackages(readFileSync(path.join(ROOT, OWNER), 'utf8'));
    expect(names.size).toBeGreaterThanOrEqual(ENUMERATION_THRESHOLD);
  });

  it('(RED) the detector fires on the list that was actually there', () => {
    // The deleted block, in its real shape. Against a detector that cannot see it, every case above
    // is a pass over nothing.
    const deleted = [
      '## Project Structure',
      '',
      '- `packages/agent-core` — core runtime',
      '- `packages/agent-cli` — the CLI',
      '- `packages/agent-provider` — providers',
      '- `packages/agent-session` — session state',
    ].join('\n');
    expect(enumeratedPackages(deleted).size).toBeGreaterThanOrEqual(ENUMERATION_THRESHOLD);
  });

  it('prose that names a package or two is not an enumeration', () => {
    const prose = '- see `packages/agent-core` for the runtime, which `packages/agent-cli` drives';
    expect(enumeratedPackages(prose).size).toBeLessThan(ENUMERATION_THRESHOLD);
  });
});
