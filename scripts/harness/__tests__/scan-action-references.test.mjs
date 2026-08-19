/**
 * INFRA-059 — a workflow's `uses:` references must be verifiable, and the guard that verifies them
 * must be provably able to FAIL.
 *
 * The defect this fences (`vercel/action@v1`, a repository that has never existed, referenced for
 * eight months and 100+ runs) fails at `Set up job`, BEFORE any step runs: no failing step in the
 * log, `--log-failed` returns the provisioner banner, and an `if:`-gated job reports the whole run
 * green. So each half is exercised on its own, with the RED case asserted first — three guards
 * written in this repository this week shipped containing the exact defect they audited, because
 * their halves were only ever exercised together and only ever on input that passed.
 *
 * The network half is tested through INJECTED probe results, never by calling GitHub: a unit suite
 * that reaches the network is a unit suite that reports the network's health. The real network runs
 * are recorded in the INFRA-059 backlog item.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ADVISORY_MARKER, extractAdvisories } from '../run-all-scans.mjs';
import {
  classifyResolution,
  expandFindings,
  findActionReferenceFindings,
  findStaticFindings,
  liveModeFor,
  parseReferences,
  pathExistsAtCommit,
  readWorkflowSources,
  resolveAll,
  unverifiedResolvabilityLine,
} from '../scan-action-references.mjs';

const REPO_ROOT = path.resolve(import.meta.dirname, '../../..');

let roots = [];
beforeEach(() => {
  roots = [];
});
afterEach(() => {
  for (const root of roots) fs.rmSync(root, { recursive: true, force: true });
});

/** A throwaway repo root holding only `.github/workflows`, so fixtures cannot touch the real tree. */
function root(workflows) {
  const created = fs.mkdtempSync(path.join(os.tmpdir(), 'action-refs-'));
  roots.push(created);
  const dir = path.join(created, '.github', 'workflows');
  fs.mkdirSync(dir, { recursive: true });
  for (const [name, body] of Object.entries(workflows)) {
    fs.writeFileSync(path.join(dir, name), body);
  }
  return created;
}

const STEP = (raw) => `jobs:\n  a:\n    steps:\n      - uses: ${raw}\n`;

describe('parseReferences', () => {
  it('reads owner, repo, subpath, ref and the pin comment off a step', () => {
    const { references } = parseReferences('x.yml', '      - uses: github/codeql-action/init@v4\n');
    expect(references).toEqual([
      expect.objectContaining({
        file: 'x.yml',
        line: 1,
        owner: 'github',
        repo: 'codeql-action',
        subpath: 'init',
        ref: 'v4',
        kind: 'action',
      }),
    ]);
  });

  it('carries the claimed tag from a `# vX` pin comment', () => {
    const sha = 'a'.repeat(40);
    const { references } = parseReferences(
      'x.yml',
      `        uses: actions/checkout@${sha} # v4.2.2\n`,
    );
    expect(references[0]).toMatchObject({ ref: sha, claimedTag: 'v4.2.2' });
  });

  /**
   * The completeness counter. A parser that silently skips a line it does not understand reports a
   * clean answer from a partial scan — the same shape as a single-page `gh` query that looks exactly
   * like a complete one. `usesLineCount` is counted independently of the parser so the two can
   * disagree, and `findStaticFindings` fails when they do.
   */
  it('counts every `uses:` line independently of what it managed to parse', () => {
    const source = ['      - uses: actions/checkout@v4', '        uses: ${{ matrix.action }}'].join(
      '\n',
    );
    const { references, usesLineCount } = parseReferences('x.yml', source);
    expect(usesLineCount).toBe(2);
    expect(references).toHaveLength(2);
    expect(references[1].kind).toBe('expression');
  });
});

describe('static half', () => {
  it('GREEN: well-formed tag references are not findings', () => {
    const sources = readWorkflowSources(root({ 'a.yml': STEP('actions/checkout@v4') }));
    expect(findStaticFindings(sources)).toEqual([]);
  });

  it('RED: a reference with no `@ref` at all', () => {
    const sources = readWorkflowSources(root({ 'a.yml': STEP('actions/checkout') }));
    expect(findStaticFindings(sources)[0].detail).toMatch(/no `@ref`/);
  });

  it('RED: a moving branch pointer is unverifiable by construction', () => {
    const sources = readWorkflowSources(root({ 'a.yml': STEP('actions/checkout@main') }));
    expect(findStaticFindings(sources)[0].detail).toMatch(/moving branch pointer/);
  });

  it('RED: an expression-valued `uses:` cannot be verified at all', () => {
    const sources = readWorkflowSources(root({ 'a.yml': STEP('${{ matrix.action }}@v1') }));
    expect(findStaticFindings(sources)[0].detail).toMatch(/expression/);
  });

  it('RED: a local `./` reference whose action manifest does not exist', () => {
    const sources = readWorkflowSources(root({ 'a.yml': STEP('./.github/actions/nope') }));
    const findings = findStaticFindings(sources, roots[0]);
    expect(findings[0].detail).toMatch(/no `action\.yml`/);
  });

  it('RED: a reference shape the guard cannot verify fails closed rather than passing', () => {
    const sources = readWorkflowSources(root({ 'a.yml': STEP('docker://alpine:3.20') }));
    expect(findStaticFindings(sources)[0].detail).toMatch(/cannot verify/);
  });

  /** A parser blind spot must fail the scan, not shrink its subject silently. */
  it('RED: parsed references fewer than the `uses:` lines counted', () => {
    const findings = findStaticFindings([{ file: 'a.yml', references: [], usesLineCount: 3 }]);
    expect(findings[0].detail).toMatch(/parsed 0 of 3/);
  });
});

describe('fail-closed — the scan never passes over nothing', () => {
  it('a missing workflow directory is a finding, not a pass', () => {
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'action-refs-empty-'));
    roots.push(empty);
    expect(findStaticFindings(readWorkflowSources(empty))[0].detail).toMatch(/examined nothing/);
  });

  it('an empty workflow directory is a finding, not a pass', () => {
    expect(findStaticFindings(readWorkflowSources(root({})))[0].detail).toMatch(/examined nothing/);
  });

  it('a workflow file with no `uses:` at all is fine — the fail-closed rule is about SCOPE', () => {
    const sources = readWorkflowSources(root({ 'a.yml': 'name: x\non:\n  push:\n' }));
    expect(findStaticFindings(sources)).toEqual([]);
  });

  /**
   * The root-taking finder `scan-guard-scope-fail-closed.mjs` executes against a bare temporary root
   * on every run. It is exported under that shape ON PURPOSE: naming it out of that scan's
   * derivation would be the defect that scan audits, one level up.
   */
  it('findActionReferenceFindings reports on a root with no `.github/workflows` at all', () => {
    const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'action-refs-bare-'));
    roots.push(bare);
    expect(findActionReferenceFindings(bare)).toHaveLength(1);
    expect(findActionReferenceFindings(bare)[0].detail).toMatch(/examined nothing/);
  });

  it('findActionReferenceFindings is hermetic — it holds on the real tree with no network', () => {
    expect(findActionReferenceFindings(REPO_ROOT)).toEqual([]);
  });
});

/**
 * WHERE the live half runs is a policy decision, and a wrong one turns a github.com incident into a
 * blocked promotion: `harness:scan` is reached by `harness:verify:release` → the `release-grade
 * verification` REQUIRED check on `protect-main`. HOW it fails (closed, always) is asserted above.
 */
describe('liveModeFor — where the network half runs', () => {
  it('runs in CI on a PR to develop', () => {
    expect(liveModeFor([], { CI: 'true', GITHUB_BASE_REF: 'develop' }).live).toBe(true);
  });

  it('does NOT run on a promotion to main — a required gate must not hang on an outage', () => {
    expect(liveModeFor([], { CI: 'true', GITHUB_BASE_REF: 'main' }).live).toBe(false);
  });

  it('does not run on a developer machine, and says why', () => {
    const mode = liveModeFor([], {});
    expect(mode.live).toBe(false);
    expect(mode.why).toMatch(/--live/);
  });

  it('`--live` and `--offline` override the environment in both directions', () => {
    expect(liveModeFor(['--live'], {}).live).toBe(true);
    expect(liveModeFor(['--offline'], { CI: 'true', GITHUB_BASE_REF: 'develop' }).live).toBe(false);
  });
});

describe('classifyResolution — the live verdicts, on injected probe results', () => {
  const reference = { file: 'deploy.yml', line: 111, raw: 'vercel/action@v1', ref: 'v1' };

  it('RED: the repository does not exist — the INFRA-058 defect', () => {
    const finding = classifyResolution(reference, { status: 'repo-missing' });
    expect(finding.detail).toMatch(/repository does not exist/);
  });

  it('RED: the repository exists but the ref does not resolve', () => {
    const finding = classifyResolution(reference, { status: 'ref-missing' });
    expect(finding.detail).toMatch(/does not resolve/);
  });

  it('RED: the ref resolves but carries no action manifest at that path', () => {
    const finding = classifyResolution(reference, {
      status: 'resolved',
      sha: 'b'.repeat(40),
      refName: 'refs/tags/v1',
      manifest: 'absent',
    });
    expect(finding.detail).toMatch(/no `action\.yml`/);
  });

  it('RED: a SHA pin whose claimed tag points somewhere else', () => {
    const finding = classifyResolution(
      { ...reference, ref: 'c'.repeat(40), claimedTag: 'v4.2.2' },
      {
        status: 'resolved',
        sha: 'c'.repeat(40),
        refName: 'refs/tags/v4.2.2',
        manifest: 'present',
        claimedTagSha: 'd'.repeat(40),
      },
    );
    expect(finding.detail).toMatch(/claims `v4\.2\.2`/);
  });

  it('RED: the claimed tag of a SHA pin no longer exists', () => {
    const finding = classifyResolution(
      { ...reference, ref: 'c'.repeat(40), claimedTag: 'v9.9.9' },
      { status: 'resolved', sha: 'c'.repeat(40), manifest: 'present', claimedTagSha: null },
    );
    expect(finding.detail).toMatch(/claims `v9\.9\.9`/);
  });

  /**
   * The criterion INFRA-059 wrote down explicitly: "a network-dependent check that cannot reach
   * GitHub must FAIL, not skip. A 'could not determine → exit 0' path here would reproduce the exact
   * defect it is meant to catch."
   */
  it('RED: unreachable is a finding — never a pass', () => {
    const finding = classifyResolution(reference, {
      status: 'unreachable',
      detail: 'ssl handshake failed',
    });
    expect(finding.detail).toMatch(/could not be verified/);
  });

  it('GREEN: a tag that resolves and carries a manifest is not a finding', () => {
    expect(
      classifyResolution(reference, {
        status: 'resolved',
        sha: 'e'.repeat(40),
        refName: 'refs/tags/v1',
        manifest: 'present',
      }),
    ).toBeNull();
  });

  it('GREEN: a SHA pin whose claimed tag points at it is not a finding', () => {
    const sha = 'f'.repeat(40);
    expect(
      classifyResolution(
        { ...reference, ref: sha, claimedTag: 'v4.2.2' },
        { status: 'resolved', sha, manifest: 'present', claimedTagSha: sha },
      ),
    ).toBeNull();
  });

  /**
   * Reported, deliberately not a finding: a major ref that resolves through `refs/heads`. It
   * resolves, so it is verifiable; whether it should be SHA-pinned is INFRA-064's question, and
   * widening scope here would redden two references this item is not authorised to bump.
   */
  it('GREEN: a ref resolving through a branch head is reported, not failed', () => {
    expect(
      classifyResolution(reference, {
        status: 'resolved',
        sha: 'a'.repeat(40),
        refName: 'refs/heads/v1',
        manifest: 'present',
      }),
    ).toBeNull();
  });
});

describe('resolveAll — every reference is accounted for', () => {
  it('probes each unique reference exactly once and returns a verdict for each', async () => {
    const references = [
      { raw: 'a/b@v1', owner: 'a', repo: 'b', ref: 'v1', kind: 'action', file: 'x.yml', line: 1 },
      { raw: 'a/b@v1', owner: 'a', repo: 'b', ref: 'v1', kind: 'action', file: 'y.yml', line: 2 },
      { raw: 'c/d@v2', owner: 'c', repo: 'd', ref: 'v2', kind: 'action', file: 'x.yml', line: 3 },
    ];
    const probed = [];
    const results = await resolveAll(references, async (reference) => {
      probed.push(reference.raw);
      return {
        status: 'resolved',
        sha: '1'.repeat(40),
        refName: 'refs/tags/x',
        manifest: 'present',
      };
    });
    expect(probed.sort()).toEqual(['a/b@v1', 'c/d@v2']);
    expect(results).toHaveLength(2);
    expect(results.every((result) => result.finding === null)).toBe(true);
  });

  /**
   * A probe that throws must not shrink the result set — the count of verdicts must equal the count
   * of unique references, always. Anything else is a partial answer wearing a complete one's shape.
   */
  it('a throwing probe becomes an unreachable finding, not a missing row', async () => {
    const references = [
      { raw: 'a/b@v1', owner: 'a', repo: 'b', ref: 'v1', kind: 'action', file: 'x.yml', line: 1 },
    ];
    const results = await resolveAll(references, async () => {
      throw new Error('getaddrinfo ENOTFOUND github.com');
    });
    expect(results).toHaveLength(1);
    expect(results[0].finding.detail).toMatch(/could not be verified/);
  });
});

describe('expandFindings — one report per occurrence, one probe per reference', () => {
  it('names EVERY line a bad reference sits on, not just one of them', () => {
    const make = (file, line) => ({
      file,
      line,
      raw: 'vercel/action@v1',
      kind: 'action',
      owner: 'vercel',
      repo: 'action',
      ref: 'v1',
    });
    const references = [make('deploy.yml', 111), make('deploy.yml', 121), make('ci.yml', 9)];
    const results = [
      {
        reference: references[0],
        resolution: { status: 'repo-missing' },
        finding: { detail: 'gone' },
      },
    ];
    expect(expandFindings(references, results).map((finding) => finding.where)).toEqual([
      'deploy.yml:111',
      'deploy.yml:121',
      'ci.yml:9',
    ]);
  });

  it('a clean verdict expands to nothing', () => {
    const reference = { file: 'a.yml', line: 1, raw: 'a/b@v1', kind: 'action' };
    expect(expandFindings([reference], [{ reference, resolution: {}, finding: null }])).toEqual([]);
  });
});

describe('the real repository', () => {
  it('every `uses:` line in every workflow is parsed — the count cannot silently shrink', () => {
    const sources = readWorkflowSources(REPO_ROOT);
    expect(sources.length).toBeGreaterThan(10);
    const total = sources.reduce((sum, entry) => sum + entry.usesLineCount, 0);
    const parsed = sources.reduce((sum, entry) => sum + entry.references.length, 0);
    expect(total).toBeGreaterThan(50);
    expect(parsed).toBe(total);
  });

  it('holds statically — no malformed, expression-valued or moving-pointer reference', () => {
    expect(findStaticFindings(readWorkflowSources(REPO_ROOT), REPO_ROOT)).toEqual([]);
  });

  // Deduping on `raw` alone kept one occurrence and let its verdict stand for all of them, so the
  // same SHA carrying `# v4.1.0` in one file and `# v9.9.9` in another collapsed to a single check
  // and whichever lost the collision was never verified — the failure this scan exists to catch,
  // surviving inside the scan that checks for it. Found in review.
  it('checks each claimed tag separately when one SHA carries two different claims', async () => {
    const references = [
      {
        file: 'a.yml',
        line: 1,
        raw: 'actions/checkout@abc123',
        claimedTag: 'v4.1.0',
        kind: 'action',
      },
      {
        file: 'b.yml',
        line: 1,
        raw: 'actions/checkout@abc123',
        claimedTag: 'v9.9.9',
        kind: 'action',
      },
    ];
    const results = await resolveAll(references, async () => ({
      ok: true,
      sha: 'abc123',
      tags: ['v4.1.0'],
    }));
    expect(results).toHaveLength(2);
    const claims = results.map((r) => r.reference?.claimedTag ?? r.claimedTag).sort();
    expect(claims).toEqual(['v4.1.0', 'v9.9.9']);
  });

  // `expandFindings` keyed on `raw` alone, undoing `resolveAll`'s disambiguation one step later:
  // both occurrences were then reported with whichever verdict survived the map, so a correctly
  // annotated line was told it claims a tag it does not. Wrong attribution is worse than a missed
  // finding — it sends the reader to a file that is fine. Found in review.
  it('attributes a tag-mismatch only to the occurrence that claims it', () => {
    const refs = [
      { file: 'a.yml', line: 1, raw: 'actions/checkout@abc', claimedTag: 'v4.1.0', kind: 'action' },
      { file: 'b.yml', line: 1, raw: 'actions/checkout@abc', claimedTag: 'v9.9.9', kind: 'action' },
    ];
    const results = [{ reference: refs[1], finding: { detail: 'claims v9.9.9 ...' } }];
    const out = expandFindings(refs, results);
    expect(out).toHaveLength(1);
    expect(out[0].where).toBe('b.yml:1');
  });

  // The tag-claim check compared `claimedTagSha` against `reference.ref`, which is a commit only for
  // a full-SHA pin. For `actions/checkout@v4 # v4.1.0` the ref is the string `v4`, so a SHA never
  // matched it and a correct, common annotation read as a mismatch. Latent — the repository passes
  // today only because no reference uses that shape. Found in review.
  describe('classifyResolution — the claimed-tag comparison', () => {
    const SHA = 'abc123def456abc123def456abc123def456abcd';
    const OTHER = 'f'.repeat(40);
    const resolved = (claimedTagSha) => ({
      ok: true,
      sha: SHA,
      manifest: 'present',
      claimedTagSha,
    });

    it('accepts a tag ref whose comment names a tag pointing at the same commit', () => {
      expect(
        classifyResolution({ raw: 'x', ref: 'v4', claimedTag: 'v4.1.0' }, resolved(SHA)),
      ).toBeNull();
    });

    it('accepts a SHA pin whose comment names a tag pointing at it', () => {
      expect(
        classifyResolution({ raw: 'x', ref: SHA, claimedTag: 'v4.1.0' }, resolved(SHA)),
      ).toBeNull();
    });

    it('still catches a mismatch on both ref shapes', () => {
      expect(
        classifyResolution({ raw: 'x', ref: SHA, claimedTag: 'v9.9.9' }, resolved(OTHER)),
      ).not.toBeNull();
      expect(
        classifyResolution({ raw: 'x', ref: 'v4', claimedTag: 'v9.9.9' }, resolved(OTHER)),
      ).not.toBeNull();
    });

    it('catches a comment naming a tag that no longer exists', () => {
      expect(
        classifyResolution({ raw: 'x', ref: SHA, claimedTag: 'v9.9.9' }, resolved(undefined)),
      ).not.toBeNull();
    });
  });
});

// ── the OFF-run notice, and whether anyone can read it ──────────────────────

/**
 * HARNESS-052, reachability axis. The live half is off locally AND off when `GITHUB_BASE_REF` is
 * `main` — and `harness:scan` is the only path that runs this scan in either place. `run-all-scans`
 * discards a passing scan's stdout, so the line saying "an action that does not exist passes this
 * run" was itself unreadable on every run that printed it. It now carries `ADVISORY_MARKER`
 * (HARNESS-053), which survives the 0 exit without changing the verdict.
 */
describe('unverifiedResolvabilityLine', () => {
  it('is absent on a live run — there is nothing unverified to declare', () => {
    expect(unverifiedResolvabilityLine({ live: true, why: 'CI' }, 12)).toBeNull();
  });

  it('reaches a reader of a PASSING run, naming the mode and the unchecked count', () => {
    const line = unverifiedResolvabilityLine({ live: false, why: '--offline' }, 12);
    expect(line).toContain(ADVISORY_MARKER);
    const [advisory] = extractAdvisories(line);
    expect(advisory).toContain('--offline');
    expect(advisory).toContain('12 reference(s)');
    expect(advisory).toContain('does not exist passes this run');
  });
});

describe('the manifest probe runs over the authenticated endpoint (INFRA-107)', () => {
  // Driven against a STUBBED runner, so the two answers that cannot be produced on demand against
  // the live API — a rate limit and a killed process — are cases rather than hopes. The live-endpoint
  // runs are recorded in the INFRA-107 backlog item.
  const REF = { owner: 'pnpm', repo: 'action-setup' };
  const SHA = 'eae0cfeb286e66ffb5155f1a79b90583a127a68b';
  const noWait = () => Promise.resolve();

  const runner = (...responses) => {
    const queue = [...responses];
    const calls = [];
    const run = (args) => {
      calls.push(args);
      return queue.length > 1 ? queue.shift() : queue[0];
    };
    run.calls = calls;
    return run;
  };

  it('reads a present path as true, through `gh api`', async () => {
    const run = runner({ status: 0, stdout: '', stderr: '' });
    await expect(pathExistsAtCommit(REF, SHA, 'action.yml', { runner: run })).resolves.toBe(true);
    // The endpoint, not a raw host: the whole point is that the request carries credentials.
    expect(run.calls[0]).toEqual([
      'api',
      `repos/pnpm/action-setup/contents/action.yml?ref=${SHA}`,
      '--silent',
    ]);
  });

  it('reads a 404 as FALSE, not as an error', async () => {
    // "This SHA carries no manifest" is the finding the scan exists to report. Folding it into the
    // transport's error channel would turn a real finding into an outage report — the same collapse,
    // one level down, that the rate limit produced.
    const run = runner({ status: 1, stdout: '', stderr: 'gh: Not Found (HTTP 404)' });
    await expect(pathExistsAtCommit(REF, SHA, 'nope.yml', { runner: run })).resolves.toBe(false);
  });

  it('retries a rate limit and succeeds when the budget returns', async () => {
    const run = runner(
      { status: 1, stdout: '', stderr: 'API rate limit exceeded\nretry-after: 1' },
      { status: 0, stdout: '', stderr: '' },
    );
    await expect(
      pathExistsAtCommit(REF, SHA, 'action.yml', { runner: run, sleep: noWait }),
    ).resolves.toBe(true);
    expect(run.calls).toHaveLength(2);
  });

  it('fails CLOSED when the budget does not return within the bound', async () => {
    // Unreachable is a failure, not a skip — the scan's own rule, and the reason it went red on a
    // shared runner address. Moving to an authenticated endpoint raises the budget; it does not make
    // exhausting it a pass.
    const run = runner({
      status: 1,
      stdout: '',
      stderr: 'API rate limit exceeded\nretry-after: 1',
    });
    await expect(
      pathExistsAtCommit(REF, SHA, 'action.yml', { runner: run, attempts: 2, sleep: noWait }),
    ).rejects.toThrow(/budget to wait out/);
  });

  it('fails closed on a transport error that is neither 404 nor a rate limit', async () => {
    const run = runner({ status: 1, stdout: '', stderr: 'dial tcp: i/o timeout' });
    await expect(pathExistsAtCommit(REF, SHA, 'action.yml', { runner: run })).rejects.toThrow(
      /i\/o timeout/,
    );
  });

  it('names the timeout when the runner was KILLED and left no stderr', async () => {
    // The first version reported this as `gh exited null`, which names neither the cause nor the
    // remedy. A probe whose failure cannot be acted on is the same defect one layer up.
    const run = runner({ status: null, signal: 'SIGTERM', stdout: '', stderr: '' });
    await expect(pathExistsAtCommit(REF, SHA, 'action.yml', { runner: run })).rejects.toThrow(
      /killed by SIGTERM/,
    );
  });
});
