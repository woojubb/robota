import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { listWorkspaceScopes } from '../shared.mjs';

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
 * WHY ONLY THESE FOUR DOCUMENTS. A blanket rule is unworkable and measuring says so: 174 of 2707
 * tracked markdown files enumerate three or more package paths, nearly all of them dated records —
 * completed Tasks, archived audits, closed spec-docs — where a listing is history and correct as
 * written. (Measured with THIS detector after it was widened to ordered lists. The first figure, 171,
 * was taken before that change and shipped in the same commit as the change — a measurement that no
 * longer described its own code.)
 *
 * What distinguishes these four is ROLE, not content: they are read as the CURRENT description of the
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
    // Bullets, table rows AND ordered lists. The first version matched only `-`, `*` and `|`, so the
    // deleted block could have come back as `1. \`packages/agent-core\` — …` and passed.
    if (!/^\s*([-*|]|\d+[.)])/.test(line)) continue;
    for (const match of line.matchAll(/\bpackages\/([a-z0-9][a-z0-9-]*)\b/g)) names.add(match[1]);
  }
  return names;
}

/**
 * Three is a listing; one or two is an example.
 *
 * It governs every case that reasons about SIZE — the owner still enumerates, the detector fires on
 * the deleted block, and prose naming one or two packages does not count as a listing. The rule on a
 * front-door document is stricter and is stated as itself: ZERO path enumerations, because the point
 * is to link rather than to list a little.
 */
const ENUMERATION_THRESHOLD = 3;

describe('the package list has one owner (HARNESS-068)', () => {
  for (const doc of FRONT_DOOR_DOCS) {
    // Named for what it checks, not for the wider idea behind it. The first version was called
    // "links to the owner instead of copying the list" and ran over README.md — which DOES list
    // packages, as an npm catalogue of `@robota-sdk/*` names the detector structurally cannot see.
    // A green case under a name broader than its rule is a claim nothing checks.
    it(`${doc} enumerates no packages/<name> paths`, () => {
      const names = enumeratedPackages(readFileSync(path.join(ROOT, doc), 'utf8'));
      expect(
        [...names],
        `${doc} enumerates ${names.size} package path(s). Link to ${OWNER} instead — a second copy ` +
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

/**
 * The rule that mattered, at the edge where it was missing.
 *
 * Deleting the copy is only half of HARNESS-068. The reason the copy was worth deleting is that it
 * named a package that does not exist, and `check-dependency-direction.mjs` Rule 9 — which fails the
 * build for exactly that — reaches only the owning document. Banning enumerations does not extend
 * that rule; it just moves the ground it cannot see.
 *
 * So the existence check itself is extended here, to every package name a front-door document uses,
 * enumeration or not. Review round 3 proved this is not hypothetical twice over: `CONTRIBUTING.md`
 * had `packages/agent-provider`, and `README.md`'s architecture diagram STILL said `agent-provider`
 * — contradicting a table twenty lines below it that lists the per-vendor packages that replaced it.
 *
 * WHAT IT CANNOT SEE — stated at its real width, because the first version of this paragraph said
 * "bare names inside a fenced diagram" and that framing steered a hand-fix straight past a second
 * one. It cannot see ANY package name carrying no `@robota-sdk/` or `packages/` prefix, anywhere in
 * the document, fence or prose: round 4 found `agent-provider` still in README's Quick Start line, in
 * inline backticks, four lines above a snippet importing `@robota-sdk/agent-provider-anthropic`.
 * A rule matching bare lowercase words would match most of a shell transcript, so the compensating
 * control is not a wider regex but a wider sweep: when a package is renamed or split, grep the
 * front-door documents for the OLD bare name — this check will not do it for you.
 */
const SCOPE_PREFIX = '@robota-sdk/';

/**
 * Package names a document actually asserts, as `<prefix><name>` tokens.
 *
 * Two forms are dropped, each because it names no package: a token ending in `*` or `-` is a GLOB
 * (`packages/dag-*`), and the placeholder words below stand in for "a package" in a command
 * template (`--scope <packages/foo|apps/bar>`).
 */
const PLACEHOLDER_NAMES = new Set(['foo', 'bar', 'name', 'your-package']);

export function namedPackages(markdown) {
  const named = new Set();
  for (const [prefix, pattern] of [
    [SCOPE_PREFIX, new RegExp(`${SCOPE_PREFIX}([a-z0-9][a-z0-9-]*)(.?)`, 'g')],
    ['packages/', /\bpackages\/([a-z0-9][a-z0-9-]*)(.?)/g],
  ]) {
    for (const [, name, next] of markdown.matchAll(pattern)) {
      if (next === '*' || name.endsWith('-')) continue;
      if (PLACEHOLDER_NAMES.has(name)) continue;
      named.add(`${prefix}${name}`);
    }
  }
  return named;
}

/**
 * A token resolves if it IS a package, or if it is the directory GROUP one lives under.
 *
 * `packages/dag-nodes/tool` is a real package and the extractor stops at `packages/dag-nodes`, which
 * is a grouping directory rather than a package — reporting it as nonexistent would be a false
 * accusation about a correct reference.
 */
function resolves(token, known) {
  if (known.has(token)) return true;
  const prefix = `${token}/`;
  for (const entry of known) if (entry.startsWith(prefix)) return true;
  return false;
}

/**
 * Every token that names a real workspace member — the ONE construction, so a case can guard it.
 *
 * `relativeDir` and `workspaceName` only. The first version also mapped every scope to
 * `packages/<shortName>`, which made 30 nonexistent paths resolve under a case named "every package
 * named in a front-door document resolves": 10 apps (`packages/www`, `packages/agent-app`, …) and —
 * the dangerous half, which the first correction of this comment left out — 20 nested
 * `packages/dag-nodes/*` scopes flattened to generic one-word paths like `packages/tool`,
 * `packages/skill`, `packages/input`. A front-door document is far likelier to write `packages/tool`
 * by mistake than `packages/www`.
 */
async function knownPackageTokens() {
  const scopes = await listWorkspaceScopes();
  // The check's own vacuity guard: an empty or tiny workspace listing would pass everything.
  expect(scopes.length).toBeGreaterThan(10);
  return new Set([
    ...scopes.map((scope) => scope.workspaceName),
    ...scopes.map((scope) => scope.relativeDir),
  ]);
}

describe('a front-door document may not name a package that does not exist (HARNESS-068)', () => {
  it('every package named in a front-door document resolves', async () => {
    const known = await knownPackageTokens();

    for (const doc of FRONT_DOOR_DOCS) {
      const unresolved = [...namedPackages(readFileSync(path.join(ROOT, doc), 'utf8'))].filter(
        (token) => !resolves(token, known),
      );
      expect(unresolved, `${doc} names package(s) that do not exist in this workspace`).toEqual([]);
    }
  });

  it('(RED) the detector sees the name that was actually wrong', () => {
    // `packages/agent-provider` — the entry that justified deleting the CONTRIBUTING copy.
    expect(namedPackages('- `packages/agent-provider` — providers')).toContain(
      'packages/agent-provider',
    );
    expect(namedPackages('install `@robota-sdk/agent-provider`')).toContain(
      '@robota-sdk/agent-provider',
    );
  });

  it('a nested or app-only package does not resolve as a top-level package path', async () => {
    // Built the way the production case builds it, from the LIVE workspace listing. Round 6 found
    // the first version constructing its own `known` literal, so re-adding the deleted
    // `packages/<shortName>` mapping reopened all 30 phantoms and this case still passed — it
    // exercised `resolves()` and left the actual defect site, the known-set construction, unguarded.
    const known = await knownPackageTokens();
    // The two halves of the hole, in the form production can reach: `namedPackages` emits only
    // `@robota-sdk/…` and `packages/…` tokens, so `packages/tool` (a `packages/dag-nodes/tool` scope
    // flattened by shortName) and `packages/agent-app` (an app) are what a document could wrongly
    // name and the old known-set would have waved through.
    expect(resolves('packages/agent-app', known)).toBe(false);
    expect(resolves('packages/tool', known)).toBe(false);
    // The other direction, so this is not passing because the set is empty.
    expect(resolves('packages/agent-core', known)).toBe(true);
    expect(resolves('apps/agent-app', known)).toBe(true);
  });

  it('a grouping directory of a real package resolves', () => {
    const known = new Set(['packages/dag-nodes/tool']);
    expect(resolves('packages/dag-nodes', known)).toBe(true);
    expect(resolves('packages/dag-nodesx', known)).toBe(false);
  });

  it('a glob or a placeholder is not a package name', () => {
    expect(namedPackages('- `packages/dag-*` are the DAG packages').size).toBe(0);
    expect(namedPackages('`--scope <packages/foo|apps/bar>`').size).toBe(0);
  });
});
