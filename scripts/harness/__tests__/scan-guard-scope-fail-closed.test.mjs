import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { makeTemp } from './make-temp.mjs';

import { findBaseHistoryFindings, listWorkflows } from '../scan-ci-base-history.mjs';
import { findAutomergePermissionFindings } from '../scan-automerge-disarm-permission.mjs';
import {
  classificationFindings,
  derivedFinders,
  findGuardScopeFindings,
  ledgerCeilingFindings,
  ledgerDriftFindings,
  MANDATORY_TREE_GUARDS,
  measuredVacuous,
  measureFinder,
  PENDING_CLASSIFICATION,
  registeredScanFiles,
  rootFinderExports,
  stripJsComments,
} from '../scan-guard-scope-fail-closed.mjs';
import { findNoFallbackFindings } from '../scan-no-fallback.mjs';
import { findFakeInSrc } from '../scan-no-fake-in-src.mjs';
import {
  findReviewTokenSupplyFindings,
  listGovernedWorkflows,
} from '../scan-review-token-supply.mjs';

const WORKSPACE_ROOT = path.resolve(import.meta.dirname, '../../..');

// `await bareRoot()` at each call site is unaffected: awaiting a non-promise is a no-op.
const bareRoot = () => makeTemp('robota-guard-scope-');

describe('derivation (the half that cannot be dodged by editing a table)', () => {
  it('reads the registration list from run-all-scans.mjs rather than a hand-list', () => {
    const files = registeredScanFiles(WORKSPACE_ROOT);
    expect(files).toContain('scan-ci-base-history.mjs');
    expect(files).toContain('scan-no-fallback.mjs');
    expect(files.length).toBeGreaterThan(50);
  });

  it('extracts only the find…/collect… exports that take a root', () => {
    const source = [
      'export function findThings(root = X) {}',
      'export function findOther(text) {}',
      'function findPrivate(root = X) {}',
      'export function helper(root = X) {}',
    ].join('\n');
    expect(rootFinderExports(source)).toEqual(['findThings']);
  });

  /**
   * The regression fixture for this scan's OWN defect. Its first derivation regex was
   * `export function (find…)\(\s*root\s*=`, which saw 20 of 50 finders: not `async`, not `collect…`,
   * not a `root` without a default — and so did not classify itself. Every line below was invisible
   * to it, and a registered scan that was unconditionally vacuous passed the completeness rule until
   * one keyword was changed.
   */
  it.each([
    ['export async function findThings(root = X) {}', 'findThings'],
    ['export function collectThings(root = X) {}', 'collectThings'],
    ['export async function collectThings(root) {}', 'collectThings'],
    ['export function findThings(root) {}', 'findThings'],
  ])('derives %s', (source, expected) => {
    expect(rootFinderExports(source)).toEqual([expected]);
  });

  /** A declaration quoted in a docstring is documentation, not code — it derived a ghost finder. */
  it('ignores a declaration that appears only inside a comment', () => {
    const source = [
      '/**',
      ' * Example: export async function findGhost(root = X) { return []; }',
      ' */',
      'export function findReal(root = X) {}',
      '// export function findAlsoGhost(root = X) {}',
    ].join('\n');
    expect(rootFinderExports(source)).toEqual(['findReal']);
  });

  it('derives every finder this repository registers, not a spelling subset', () => {
    // Guards against a silent narrowing of the regex: the count may grow, never collapse.
    expect(derivedFinders(WORKSPACE_ROOT).length).toBeGreaterThanOrEqual(50);
  });

  it('classifies its own async finder', () => {
    const declared = [...MANDATORY_TREE_GUARDS, ...PENDING_CLASSIFICATION].map(
      (e) => `${e.file}#${e.finder}`,
    );
    expect(declared).toContain('scan-guard-scope-fail-closed.mjs#findGuardScopeFindings');
  });

  it('classifies every derived finder exactly once', () => {
    expect(classificationFindings(WORKSPACE_ROOT)).toEqual([]);
  });

  /**
   * HARNESS-052. "Exactly one" was enforced only ACROSS the two tables, so a finder listed twice in
   * PENDING_CLASSIFICATION passed — and one was: `scan-test-selection-tolerance
   * #findTestSelectionFindings`, measured twice per run and counted twice in the summary. A rule
   * whose stated claim is "exactly one" and whose implementation checks "not in both tables" is this
   * item's subject at one-line scale.
   */
  it('reports a finder listed twice within one table', () => {
    const duplicated = { ...PENDING_CLASSIFICATION[0] };
    PENDING_CLASSIFICATION.push(duplicated);
    try {
      const findings = classificationFindings(WORKSPACE_ROOT);
      expect(findings.map((f) => f.detail).join('\n')).toContain(
        'appears 2 times in PENDING_CLASSIFICATION',
      );
    } finally {
      PENDING_CLASSIFICATION.pop();
    }
    expect(classificationFindings(WORKSPACE_ROOT)).toEqual([]);
  });

  it('reports a derived finder that no table classifies', () => {
    const declared = new Set(
      [...MANDATORY_TREE_GUARDS, ...PENDING_CLASSIFICATION].map((e) => `${e.file}#${e.finder}`),
    );
    for (const entry of derivedFinders(WORKSPACE_ROOT)) {
      expect(declared.has(`${entry.file}#${entry.finder}`)).toBe(true);
    }
  });

  it('keeps the vacuous ledger non-empty — an empty one would read as "all clear"', () => {
    expect(measuredVacuous().length).toBeGreaterThan(0);
  });
});

/**
 * PROC-016 regression. The registration file gained glob constants such as `const AGENTS =
 * '.agents/**'`, and the comment stripper was a regex that did not know it was inside a string: the
 * `/**` opened a "comment" that ran to the next `*\/` and swallowed most of `SCAN_COMMANDS`, so
 * `registeredScanFiles()` parsed 4 scans and reported every other finder as no longer registered.
 * A string is code; only a `/*` or `//` met outside one may open a comment.
 */
describe('comment stripping is string-aware (PROC-016)', () => {
  const registrationOf = (files) =>
    files
      .map((file) => `  { name: 'x', command: ['node', 'scripts/harness/${file}'] },`)
      .join('\n');

  it('does not open a comment on the `/**` inside a glob string literal', () => {
    const source = [
      "const AGENTS = '.agents/**';",
      'const DOCS = "docs/**";',
      'const ALL = `**/*`;',
      'export const SCAN_COMMANDS = [',
      registrationOf(['scan-one.mjs', 'scan-two.mjs', 'scan-three.mjs']),
      '  { name: "y", command: ["node", "scripts/harness/scan-four.mjs"], examines: [AGENTS] },',
      '];',
    ].join('\n');
    const stripped = stripJsComments(source);
    expect(stripped).toContain("'.agents/**'");
    expect(stripped).toContain('scan-four.mjs');
    const files = [...stripped.matchAll(/scripts\/harness\/([a-z0-9-]+\.mjs)/g)].map((m) => m[1]);
    expect(files).toEqual(['scan-one.mjs', 'scan-two.mjs', 'scan-three.mjs', 'scan-four.mjs']);
  });

  it('yields every registration of a run-all-scans.mjs that declares glob constants', () => {
    const root = bareRoot();
    mkdirSync(path.join(root, 'scripts/harness'), { recursive: true });
    writeFileSync(
      path.join(root, 'scripts/harness/run-all-scans.mjs'),
      [
        "const AGENTS = '.agents/**';",
        "const HARNESS = 'scripts/harness/**';",
        'export const SCAN_COMMANDS = [',
        "  { name: 'a', command: ['node', 'scripts/harness/scan-alpha.mjs'], examines: [AGENTS] },",
        "  { name: 'b', command: ['node', 'scripts/harness/scan-beta.mjs'], examines: [HARNESS] },",
        "  { name: 'c', command: ['node', 'scripts/harness/scan-gamma.mjs'], always: true },",
        '];',
        '',
      ].join('\n'),
    );
    expect(registeredScanFiles(root)).toEqual([
      'scan-alpha.mjs',
      'scan-beta.mjs',
      'scan-gamma.mjs',
    ]);
  });

  /** HARNESS-052's property, re-pinned against the tokenizer: prose is still not structure. */
  it('still excludes a registration that is commented out', () => {
    const source = [
      "const AGENTS = '.agents/**';",
      'export const SCAN_COMMANDS = [',
      "  { name: 'a', command: ['node', 'scripts/harness/scan-alive.mjs'], examines: [AGENTS] },",
      "  // { name: 'b', command: ['node', 'scripts/harness/scan-line-dead.mjs'] },",
      "  /* { name: 'c', command: ['node', 'scripts/harness/scan-block-dead.mjs'] }, */",
      '  /*',
      "   * { name: 'd', command: ['node', 'scripts/harness/scan-doc-dead.mjs'] },",
      '   */',
      '];',
    ].join('\n');
    const stripped = stripJsComments(source);
    expect(stripped).toContain('scan-alive.mjs');
    expect(stripped).not.toContain('scan-line-dead.mjs');
    expect(stripped).not.toContain('scan-block-dead.mjs');
    expect(stripped).not.toContain('scan-doc-dead.mjs');
  });

  it('keeps a `//` that is inside a string, and a bare `://` scheme', () => {
    const source = [
      "const url = 'https://x'; // trailing note",
      'const doc = "see https://y/z";',
      'const bare = https://example.test;',
    ].join('\n');
    const stripped = stripJsComments(source);
    expect(stripped).toContain("'https://x'");
    expect(stripped).not.toContain('trailing note');
    expect(stripped).toContain('"see https://y/z"');
    expect(stripped).toContain('https://example.test');
  });

  it('honours an escaped quote inside a string and does not let it open a comment', () => {
    const source = [
      "const s = 'it\\'s /* not a comment */';",
      "const t = '/* still text */';",
    ].join('\n');
    expect(stripJsComments(source)).toBe(source);
  });

  it('does not let a comment containing a quote swallow the code after it', () => {
    const source = [
      "// don't stop here",
      "/* it's a block */ export function findReal(root = X) {}",
      "const q = 'ok';",
    ].join('\n');
    expect(rootFinderExports(source)).toEqual(['findReal']);
    expect(stripJsComments(source)).toContain("const q = 'ok';");
  });
});

/**
 * The behavioural half, and the regression fixtures for the five guards this item repaired. Each of
 * these returned an EMPTY finding list — i.e. reported a pass — when handed a root without its
 * governed tree, measured on 2026-07-26. A revert of any repair fails the matching case here.
 */
describe('the repaired guards fail closed on an absent governed tree', () => {
  it('listWorkflows throws instead of returning []', async () => {
    const root = await bareRoot();
    expect(() => listWorkflows(root)).toThrow(/does not exist/);
  });

  it('listGovernedWorkflows throws instead of returning []', async () => {
    const root = await bareRoot();
    expect(() => listGovernedWorkflows(root)).toThrow(/does not exist/);
  });

  it.each([
    ['findBaseHistoryFindings', findBaseHistoryFindings],
    ['findAutomergePermissionFindings', findAutomergePermissionFindings],
    ['findReviewTokenSupplyFindings', findReviewTokenSupplyFindings],
    ['findNoFallbackFindings', findNoFallbackFindings],
    ['findFakeInSrc', findFakeInSrc],
  ])('%s does not report a pass over a tree it never read', async (_name, finder) => {
    const root = await bareRoot();
    let threw = false;
    let result;
    try {
      result = finder(root);
    } catch {
      threw = true;
    }
    if (threw) return;
    const list = Array.isArray(result) ? result : (result?.findings ?? []);
    expect(list.length).toBeGreaterThan(0);
  });

  /**
   * The token-supply scan's anti-rot half (inherited from the parity scan it replaced): a workflows directory that exists but in which nothing invokes
   * the governed action is an empty subject, not a clean one. Before the repair this returned no
   * findings and `main()` printed "nothing to guard" and exited 0 — the scan whose whole subject is
   * an action that exits 0 having reviewed nothing, doing exactly that.
   */
  it('token-supply reports an empty governed set as a finding', async () => {
    const { mkdirSync, writeFileSync } = await import('node:fs');
    const root = await bareRoot();
    mkdirSync(path.join(root, '.github', 'workflows'), { recursive: true });
    writeFileSync(
      path.join(root, '.github', 'workflows', 'ci.yml'),
      'name: ci\njobs: {}\n',
      'utf8',
    );
    const { findings, checked } = findReviewTokenSupplyFindings(root);
    expect(checked).toEqual([]);
    expect(findings).toHaveLength(1);
    expect(findings[0].detail).toMatch(/governs an empty set/);
  });
});

/**
 * Rule 3. The ledger went stale within the hour it was written — repairing `scan-conflict-markers`
 * turned it fail-closed while the ledger still recorded `vacuous`. A debt ledger nobody re-measures
 * is a set of claims about the past presented as facts about the present.
 */
describe('ledger freshness', () => {
  it('every recorded measurement still matches what the finder does', async () => {
    expect(await ledgerDriftFindings(WORKSPACE_ROOT)).toEqual([]);
  });

  it('measures by executing, and distinguishes unmeasurable from fail-closed', async () => {
    // The `vacuous` example was `scan-orchestration-map#collectOrchestrationMapFindings` until
    // HARNESS-052 repaired it. This one is a pure ENUMERATOR whose caller renders the verdict, so
    // its empty answer over a bare root is honest and expected to stay `vacuous` — a fixed point to
    // measure against rather than a defect waiting to be fixed out from under the test.
    const vacuous = await measureFinder(
      { file: 'scan-vitest-resource-ceiling.mjs', finder: 'findVitestConfigs' },
      WORKSPACE_ROOT,
    );
    expect(vacuous).toBe('vacuous');

    // A module that cannot be loaded has told us nothing about its finder. Scoring that as correct
    // is how the first ledger recorded several import crashes as `fail-closed`.
    const unmeasurable = await measureFinder(
      { file: 'no-such-scan-file.mjs', finder: 'findAnything' },
      WORKSPACE_ROOT,
    );
    expect(unmeasurable).toBe('unmeasurable');
  });

  it('exempts only the self-referential entry, and states it in data', () => {
    const exempt = PENDING_CLASSIFICATION.filter((entry) => entry.selfReferential);
    expect(exempt).toHaveLength(1);
    expect(exempt[0].file).toBe('scan-guard-scope-fail-closed.mjs');
  });
});

describe('the scan as a whole', () => {
  it('is green on this repository', async () => {
    expect(await findGuardScopeFindings(WORKSPACE_ROOT)).toEqual([]);
  });
});

describe('rule 4 — the debt ledger may shrink and never grow (HARNESS-064)', () => {
  /**
   * Rules 1–3 make every finder answer for itself and keep the ledger honest, but they placed no
   * bound on its SIZE. A new scan could be classified `pending` forever, and a new `vacuous` entry —
   * a LIVE instance of the defect this scan audits — could be added with a paragraph explaining it,
   * and nothing objected. The count appeared only in the pass message.
   */
  it('a new VACUOUS entry fails, because it is a new live instance of the audited defect', () => {
    const findings = ledgerCeilingFindings({ vacuous: 0, unpinned: 99 });
    expect(findings.map((f) => f.subject)).toContain('ledger-ceiling:vacuous');
    expect(findings.find((f) => f.subject === 'ledger-ceiling:vacuous')?.detail).toMatch(
      /fix the guard, do not record it/,
    );
  });

  it('a new UNPINNED entry fails, and says to pin it instead', () => {
    const findings = ledgerCeilingFindings({ vacuous: 99, unpinned: 0 });
    expect(findings.find((f) => f.subject === 'ledger-ceiling:unpinned')?.detail).toMatch(
      /Pin the guard in MANDATORY_TREE_GUARDS/,
    );
  });

  it('a FALL must be re-frozen in the same change, not silently pocketed', () => {
    // The other half of a ratchet. An unlocked gain is a licence to grow back to the old number,
    // which is how a debt ceiling stops meaning anything.
    const findings = ledgerCeilingFindings({ vacuous: 99, unpinned: 99 });
    expect(findings).toHaveLength(2);
    for (const finding of findings) {
      expect(finding.detail).toMatch(/DOWN from a frozen/);
    }
  });

  it('an absent ceiling is a finding, not a pass', () => {
    // "No ceiling recorded" must not read as "within the ceiling" — that is the vacuity this whole
    // scan exists to catch, one level up again.
    expect(ledgerCeilingFindings({}).map((f) => f.subject)).toEqual([
      'ledger-ceiling:vacuous',
      'ledger-ceiling:unpinned',
    ]);
  });

  it('the live repository is at its frozen ceilings', () => {
    expect(ledgerCeilingFindings()).toEqual([]);
  });

  /**
   * REACHABILITY through the registered path, not just the exported function.
   *
   * The first draft of these cases called `ledgerCeilingFindings` directly, so deleting the line
   * that wires it into `findGuardScopeFindings` failed nothing — the check existed and ran nowhere,
   * which is the shape this scan audits. This runs the scan as the CLI does, over a deliberately
   * wrong ceiling file, and requires a non-zero exit.
   */
  it('a violated ceiling fails the SCAN, not just the helper', () => {
    const root = path.resolve(import.meta.dirname, '../../..');
    const frozen = JSON.parse(
      readFileSync(path.join(root, 'scripts/harness/guard-ledger-ceilings.json'), 'utf8'),
    );
    // A TEMP ceiling file, never the checked-in one. Mutating the real file and restoring it in a
    // `finally` leaves the working tree corrupted if the process is killed in between — and this
    // scan's own docstring records a harness scan dying mid-run with no output.
    const dir = makeTemp('guard-ledger-');
    const ceilingsPath = path.join(dir, 'ceilings.json');
    writeFileSync(ceilingsPath, JSON.stringify({ ...frozen, vacuous: frozen.vacuous - 1 }));
    try {
      const result = spawnSync('node', ['scripts/harness/scan-guard-scope-fail-closed.mjs'], {
        cwd: root,
        encoding: 'utf8',
        env: { ...process.env, GUARD_LEDGER_CEILINGS: ceilingsPath },
      });
      expect(result.status).toBe(1);
      expect(result.stdout).toMatch(/ledger-ceiling:vacuous/);
      // The seam that made this case safe is itself a way past the ratchet, so a run that did not
      // read the frozen file has to SAY so. Silent is the one thing it must not be.
      expect(result.stdout).toMatch(/ceilings OVERRIDDEN via GUARD_LEDGER_CEILINGS=/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
