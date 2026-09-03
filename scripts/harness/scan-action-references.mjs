#!/usr/bin/env node

/**
 * Action-reference resolvability guard (INFRA-059).
 *
 * `deploy.yml` referenced `vercel/action@v1` — a repository that does not exist — for eight months (allow-missing-artifact: INFRA-058 deleted it; this is the history the scan exists for)
 * and 100+ runs. An unresolvable `uses:` fails at `Set up job`, BEFORE any step runs, so there is no
 * failing step in the log, `--log-failed` returns only the provisioner banner, and an `if:`-gated or
 * skipped job reports the whole run GREEN. It is the quietest possible CI failure, and nothing here
 * would have caught the next one.
 *
 * TWO HALVES, because either alone passes over the defect:
 *
 *   STATIC (always). Every `uses:` is parsed and must be a shape this guard can verify: no missing
 *   `@ref`, no `main`/`master`/`HEAD` (a moving pointer cannot be verified — what ran yesterday is
 *   not what runs today), no `${{ }}` expression, no unsupported scheme, and a local `./` reference
 *   must actually carry an action manifest. Unrecognised shapes FAIL rather than pass unexamined.
 *   The parser also counts `uses:` lines INDEPENDENTLY of what it managed to parse and fails when
 *   the two disagree — a parser blind spot otherwise reports a complete answer from a partial scan,
 *   the same shape as a single-page `gh` query that looks exactly like a finished one.
 *
 *   LIVE. Each unique reference is resolved against the real remote: `git ls-remote` for the
 *   repository and the ref, then the action manifest is fetched at the resolved commit — which is
 *   what "resolvable" actually means to the runner, and what catches a valid repo with a typo'd
 *   subpath. A full-SHA pin is verified to exist, and its `# vX` comment is checked against where
 *   that tag really points.
 *
 * THE NETWORK PATH FAILS CLOSED WHEREVER IT RUNS. Unreachable is a FINDING, never a skip
 * (INFRA-059's acceptance criterion 3): a "could not determine → exit 0" path reproduces the exact
 * defect the guard exists to catch. `git ls-remote` runs with `GIT_TERMINAL_PROMPT=0` and a hard
 * timeout, because a 404 repository against an interactive credential helper otherwise BLOCKS
 * forever — a hang is not a verdict either.
 *
 * WHERE IT RUNS is a separate question from how it fails, and the two were conflated in this item's
 * first design. The live half is ON in CI on a PR to `develop`, OFF locally, and OFF when
 * `GITHUB_BASE_REF` is `main` (`--live` / `--offline` force it either way). `harness:scan` is
 * reached by `harness:verify:release` → the `release-grade verification` REQUIRED check on
 * `protect-main`, so a live half running there converts any github.com incident into a blocked
 * promotion — the failure mode `ruleset-drift.yml` documents in its own header ("an outage costs a
 * red cron, never a blocked promotion"). The develop-side `scans` job already ruled on the identical
 * tree, which `scan-promotion-ancestry.mjs` A3 pins, so the promotion is not running unverified.
 *
 * DELIBERATELY NOT A FINDING: a major ref that resolves through `refs/heads/<v>` rather than a tag
 * (measured: `pnpm/action-setup@v2`, `actions/dependency-review-action@v5`). It resolves, so it is
 * verifiable; whether major refs should be SHA-pinned is a separate supply-chain question filed as
 * HARNESS-055, and answering it here would redden references this item cannot bump. Branch-resolved
 * references are listed in the summary so the follow-up has a live inventory.
 *
 * SCOPE (honest, and measured):
 *   - This guard is not `actionlint`. It rules on reference RESOLVABILITY only — not expression
 *     syntax, context typing, or `run:` shell correctness. That coverage is NOT delivered by
 *     INFRA-059 and is filed as INFRA-064 rather than left implied.
 *   - The SHA-pin rule has ZERO live subjects today: all 13 references are `@vN`, none is
 *     SHA-pinned. Its passing says nothing about this repository — only the tests exercise it.
 *   - PR-time coverage stops at `develop`: the `scans` job carries `if: github.base_ref != 'main'`.
 *   - A reference rots without a PR (an upstream repo deleted, a tag force-moved). No PR-time check
 *     can see that; catching it needs a scheduled run, which is INFRA-064's other half.
 *
 * Exit 0 = every reference resolves to a commit carrying an action manifest, 1 = at least one does
 * not, or could not be checked.
 */

import { execFile, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';

import { ADVISORY_MARKER } from './run-all-scans.mjs';
import { isRateLimited, retryDelaySeconds } from './github-api.mjs';
import { envWithoutGitVars, resolveWorkspaceRoot } from './shared.mjs';

const execFileAsync = promisify(execFile);
const WORKSPACE_ROOT = resolveWorkspaceRoot(import.meta);
const WORKFLOW_DIR = '.github/workflows';
const MOVING_POINTERS = new Set(['main', 'master', 'HEAD']);
const SHA_PATTERN = /^[0-9a-f]{40}$/;
const MANIFEST_NAMES = ['action.yml', 'action.yaml'];
const PROBE_CONCURRENCY = 6;
const GIT_TIMEOUT_MS = 45_000;
const HTTP_TIMEOUT_MS = 20_000;
const MAX_REPORTED = 25;

/** Parse every `uses:` in one workflow, and count the lines independently of what parsed. */
export function parseReferences(file, source) {
  const references = [];
  let usesLineCount = 0;
  source.split('\n').forEach((text, index) => {
    // Counted INDEPENDENTLY of the parse regex below, and deliberately looser: a `uses:` the parser
    // does not recognise must still be counted, or the counter can only ever agree with itself.
    if (!/(?:^|\s)uses:\s/.test(uncomment(text))) return;
    usesLineCount += 1;
    const match = /^\s*(?:-\s+)?uses:\s*(\S.*?)\s*$/.exec(text);
    if (!match) return;
    const [value, comment] = splitComment(match[1]);
    const reference = { file, line: index + 1, raw: value, claimedTag: claimedTagOf(comment) };
    references.push({ ...reference, ...classifyShape(value) });
  });
  return { references, usesLineCount };
}

/** Drop a trailing `#` comment, so a commented-out `# uses:` is not counted as a reference. */
function uncomment(text) {
  const at = text.search(/(?:^|\s)#/);
  return at === -1 ? text : text.slice(0, at);
}

/** Split `owner/repo@ref # v1.2.3` into its value and its trailing comment. */
function splitComment(text) {
  const at = text.indexOf(' #');
  if (at === -1) return [unquote(text), ''];
  return [unquote(text.slice(0, at).trim()), text.slice(at + 2).trim()];
}

function unquote(text) {
  return /^(['"]).*\1$/.test(text) ? text.slice(1, -1) : text;
}

function claimedTagOf(comment) {
  const match = /^(v[\w.+-]+)/.exec(comment);
  return match ? match[1] : null;
}

/** Decide what KIND of reference this is — an unrecognised shape is never treated as fine. */
function classifyShape(value) {
  if (value.includes('${{')) return { kind: 'expression' };
  if (value.startsWith('./') || value.startsWith('.\\')) return { kind: 'local' };
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) return { kind: 'unsupported' };
  if (!/^[\w.-]+\/[\w.-]+(\/[\w./-]+)?@.+$/.test(value)) {
    return { kind: value.includes('@') ? 'unsupported' : 'unpinned' };
  }
  const [spec, ref] = splitLast(value, '@');
  const [owner, repo, ...rest] = spec.split('/');
  return { kind: 'action', owner, repo, subpath: rest.join('/'), ref };
}

function splitLast(text, separator) {
  const at = text.lastIndexOf(separator);
  return [text.slice(0, at), text.slice(at + 1)];
}

/** Read `.github/workflows` and parse it. A missing or empty directory yields an EMPTY list. */
export function readWorkflowSources(repoRoot = WORKSPACE_ROOT) {
  const dir = path.join(repoRoot, WORKFLOW_DIR);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'))
    .sort()
    .map((name) => ({
      file: name,
      ...parseReferences(name, fs.readFileSync(path.join(dir, name), 'utf8')),
    }));
}

/** Everything decidable without the network. `sources` is what `readWorkflowSources` returned. */
export function findStaticFindings(sources, repoRoot = WORKSPACE_ROOT) {
  if (sources.length === 0) {
    return [
      {
        where: WORKFLOW_DIR,
        detail:
          'no workflow files found — this scan examined nothing, which is an error and never a pass',
      },
    ];
  }
  const findings = [];
  for (const { file, references, usesLineCount } of sources) {
    if (references.length !== usesLineCount) {
      findings.push({
        where: file,
        detail: `parsed ${references.length} of ${usesLineCount} \`uses:\` line(s) — a guard that under-counts its own subject reports a complete answer from a partial scan`,
      });
    }
    for (const reference of references) findings.push(...staticFindingsFor(reference, repoRoot));
  }
  return findings;
}

function staticFindingsFor(reference, repoRoot) {
  const at = `${reference.file}:${reference.line}`;
  const fail = (detail) => [{ where: at, detail: `\`${reference.raw}\` ${detail}` }];
  if (reference.kind === 'expression') {
    return fail(
      'is an expression — its value is only known at run time, so no check can verify it. Reference the action literally.',
    );
  }
  if (reference.kind === 'unpinned')
    return fail('has no `@ref` — nothing identifies what would run');
  if (reference.kind === 'unsupported') {
    return fail(
      'is a reference shape this guard cannot verify (only `owner/repo[/path]@ref` and `./local` are supported). Extend the guard before landing it.',
    );
  }
  if (reference.kind === 'local') {
    const dir = path.join(repoRoot, reference.raw);
    const present = MANIFEST_NAMES.some((name) => fs.existsSync(path.join(dir, name)));
    return present
      ? []
      : fail('has no `action.yml` / `action.yaml` at that path in this repository');
  }
  if (MOVING_POINTERS.has(reference.ref)) {
    return fail(
      `names the moving branch pointer \`${reference.ref}\` — what ran yesterday is not what runs today, so no verification of it holds`,
    );
  }
  return [];
}

/**
 * The STATIC half as one root-taking finder, hermetic and fail-closed on an absent or empty
 * `.github/workflows`. `scan-guard-scope-fail-closed.mjs` executes this against a bare temporary
 * root on every run and requires it to report a finding; naming the export around that derivation
 * would be the audited defect one level up, so the seam is drawn to be visible to it instead.
 */
export function findActionReferenceFindings(root = WORKSPACE_ROOT) {
  return findStaticFindings(readWorkflowSources(root), root);
}

/**
 * Where the live half runs. `--live` / `--offline` are explicit; otherwise CI runs it, a developer
 * machine does not, and a promotion to `main` does not (see the header — a required promotion gate
 * must not be able to go red on a github.com incident).
 */
export function liveModeFor(argv, env = process.env) {
  if (argv.includes('--live')) return { live: true, why: '--live' };
  if (argv.includes('--offline')) return { live: false, why: '--offline' };
  if (!env.CI) return { live: false, why: 'not CI — run with --live to verify resolvability' };
  if (env.GITHUB_BASE_REF === 'main') {
    return {
      live: false,
      why: 'promotion to `main` — the develop-side run ruled on this same tree',
    };
  }
  return { live: true, why: 'CI' };
}

/** Turn one probe result into a finding, or `null`. Pure — every live verdict is decided here. */
export function classifyResolution(reference, resolution) {
  const at = `${reference.file}:${reference.line}`;
  const fail = (detail) => ({ where: at, detail: `\`${reference.raw}\` ${detail}` });
  if (resolution.status === 'repo-missing') {
    return fail(
      'the repository does not exist (or is not public). Every run of this workflow dies at `Set up job` with `Unable to resolve action`, before any step reports.',
    );
  }
  if (resolution.status === 'ref-missing') {
    return fail('the ref does not resolve to a tag, branch or commit in that repository');
  }
  if (resolution.status === 'unreachable') {
    return fail(
      `could not be verified: ${resolution.detail}. Unreachable is a failure, not a skip — a "could not determine, exit 0" path is the defect this guard exists to catch.`,
    );
  }
  if (resolution.manifest === 'absent') {
    return fail(
      `resolves to ${resolution.sha.slice(0, 12)} but carries no \`action.yml\` / \`action.yaml\` at that path — the runner would fail to resolve it`,
    );
  }
  // Compared against what the REF RESOLVES TO, not the ref string. `reference.ref` is only a commit
  // for a full-SHA pin; for `actions/checkout@v4 # v4.1.0` it is the string `v4`, so comparing a SHA
  // to it never matches and a correct, common annotation reads as a mismatch. Measured before the
  // fix: that shape produced a finding saying `v4.1.0` "points at" the very commit `v4` resolves to.
  // The repository passes today only because no reference currently uses it — a latent false
  // positive, and a guard that fires on correct configuration is one that gets switched off.
  if (reference.claimedTag && resolution.claimedTagSha !== resolution.sha) {
    const points = resolution.claimedTagSha
      ? `points at ${resolution.claimedTagSha.slice(0, 12)}`
      : 'no longer exists';
    return fail(`claims \`${reference.claimedTag}\` in its comment, but that tag ${points}`);
  }
  return null;
}

/** Resolve `owner/repo@ref` against the real remote. Throws only for genuinely unexpected errors. */
export async function probeReference(reference) {
  const url = `https://github.com/${reference.owner}/${reference.repo}.git`;
  let sha = SHA_PATTERN.test(reference.ref) ? reference.ref : null;
  let refName = null;
  if (sha === null) {
    const refs = await lsRemote(url, [
      `refs/tags/${reference.ref}`,
      `refs/tags/${reference.ref}^{}`,
      `refs/heads/${reference.ref}`,
    ]);
    if (refs.length === 0) return { status: 'ref-missing' };
    const peeled = refs.find((entry) => entry.name.endsWith('^{}')) ?? refs[0];
    sha = peeled.sha;
    refName = peeled.name.replace(/\^\{\}$/, '');
  }
  const manifest = (await manifestExists(reference, sha)) ? 'present' : 'absent';
  const resolution = { status: 'resolved', sha, refName, manifest };
  if (!reference.claimedTag) return resolution;
  const claimed = await lsRemote(url, [
    `refs/tags/${reference.claimedTag}`,
    `refs/tags/${reference.claimedTag}^{}`,
  ]);
  const peeled = claimed.find((entry) => entry.name.endsWith('^{}')) ?? claimed[0];
  return { ...resolution, claimedTagSha: peeled ? peeled.sha : null };
}

async function lsRemote(url, patterns) {
  try {
    const { stdout } = await execFileAsync('git', ['ls-remote', url, ...patterns], {
      timeout: GIT_TIMEOUT_MS,
      env: { ...envWithoutGitVars(), GIT_TERMINAL_PROMPT: '0', GIT_ASKPASS: 'true' },
    });
    return stdout
      .split('\n')
      .filter(Boolean)
      .map((line) => ({ sha: line.split('\t')[0], name: line.split('\t')[1] }));
  } catch (error) {
    const message = `${error.stderr ?? ''}${error.message ?? ''}`;
    if (/not found|does not exist|Authentication failed|access denied/i.test(message)) {
      throw new RepositoryMissingError(message.trim().split('\n')[0]);
    }
    throw error;
  }
}

class RepositoryMissingError extends Error {}

/** Collapse a multi-line tool error into one readable line — 80 of them in an outage is enough. */
function oneLine(value) {
  const text = String(value)
    .replace(/\s*\n\s*/g, ' | ')
    .trim();
  return text.length > 200 ? `${text.slice(0, 200)}…` : text;
}

/**
 * One authenticated read of a repository path at a commit — 200, 404, or throw.
 *
 * INFRA-107. This used an unauthenticated `fetch` of `raw.githubusercontent.com`, which is
 * rate-limited per source address while GitHub-hosted runners share theirs. Measured on two
 * consecutive runs of unchanged workflow files: 2 findings, then 15, every one `HTTP 429`. The rerun
 * being WORSE is the point — a retry does not recover that budget, it spends more of it — and this
 * scan is fail-closed by design, so the gate went red for a reason no change here could affect.
 *
 * Measured before the switch: the authenticated contents endpoint answers 200 for a present manifest
 * and a clean 404 for an absent one, on a 5,000-per-hour budget, and reports what is left. The
 * anonymous endpoint publishes no rate-limit headers at all, which is the difference between a limit
 * that can be diagnosed and one that can only be suffered.
 *
 * It goes through `gh`, the runner this harness uses everywhere else, so the request is authenticated
 * by construction and the rate-limit reading in `github-api.mjs` applies unchanged. A second network
 * path with its own retry rules would be a second place for this to go wrong.
 */
function ghContentsRunner(args) {
  return spawnSync('gh', args, {
    encoding: 'utf8',
    timeout: HTTP_TIMEOUT_MS,
    maxBuffer: 8 * 1024 * 1024,
  });
}

/** Whether the failure the runner reported is the endpoint saying "no such path". */
function isNotFound(stderr) {
  return /HTTP 404|Not Found/i.test(stderr ?? '');
}

/**
 * `true` when the path exists at that commit, `false` when it does not, throw otherwise.
 *
 * A 404 is a NEGATIVE ANSWER, not an error. "This SHA carries no manifest" is the finding this scan
 * exists to report, and folding it into the transport's error channel would turn a real finding into
 * an outage report — the same collapse, one level down, that the rate limit produced.
 */
export async function pathExistsAtCommit(
  reference,
  sha,
  filePath,
  { runner = ghContentsRunner, attempts = 3, sleep = sleepSeconds } = {},
) {
  const endpoint = `repos/${reference.owner}/${reference.repo}/contents/${filePath}?ref=${sha}`;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const response = runner(['api', endpoint, '--silent']);
    if (response.status === 0) return true;
    const stderr = (response.stderr ?? '').trim();
    if (isNotFound(stderr)) return false;
    if (!isRateLimited(stderr)) {
      throw new Error(`${endpoint}: ${oneLine(stderr || describeExit(response))}`);
    }
    if (attempt === attempts) {
      throw new Error(
        `${endpoint}: rate limited by the GitHub API and still limited after ${attempts} attempts. ` +
          'This is a budget to wait out, not a defect to work around. Last response: ' +
          `${oneLine(stderr || 'no stderr')}`,
      );
    }
    await sleep(retryDelaySeconds(stderr));
  }
  // Unreachable: the loop either returns or throws on its final attempt. Stated rather than left to
  // an implicit `undefined`, which a caller would read as "no manifest".
  throw new Error(`${endpoint}: exhausted ${attempts} attempts without a verdict.`);
}

/**
 * Why the runner produced no stderr to quote.
 *
 * `status: null` means the process was KILLED — by the timeout here, or by a signal — and the first
 * version of this reported it as `gh exited null`, which names neither the cause nor the remedy. A
 * probe whose failure message cannot be acted on is the same defect as one that fails for an
 * unreadable reason, one layer up.
 */
function describeExit(response) {
  if (response.error) return `gh could not run: ${response.error.message}`;
  if (response.signal) return `gh was killed by ${response.signal} (timeout ${HTTP_TIMEOUT_MS}ms)`;
  if (response.status === null) return `gh produced no exit status (timeout ${HTTP_TIMEOUT_MS}ms)`;
  return `gh exited ${response.status} with no stderr`;
}

function sleepSeconds(seconds) {
  return new Promise((resolve) => {
    setTimeout(resolve, Math.max(0, seconds) * 1000);
  });
}

/** The manifest the runner itself needs, at the exact commit the ref resolved to. */
async function manifestExists(reference, sha, options = {}) {
  const prefix = reference.subpath ? `${reference.subpath}/` : '';
  // A reusable workflow reference IS its own manifest — its subpath names the file.
  const candidates = /\.ya?ml$/.test(reference.subpath ?? '')
    ? [reference.subpath]
    : MANIFEST_NAMES.map((name) => `${prefix}${name}`);
  for (const candidate of candidates) {
    if (await pathExistsAtCommit(reference, sha, candidate, options)) return true;
  }
  return false;
}

/**
 * Probe every UNIQUE reference under a bounded pool and return one verdict per reference — the
 * count of verdicts always equals the count of unique references, including when a probe throws.
 */
export async function resolveAll(references, probe = probeReference) {
  // The key includes the CLAIMED TAG, not just `raw`. Deduping on `raw` alone drops every
  // occurrence but one, and the surviving entry decides the tag-mismatch verdict for all of them:
  // `actions/checkout@<sha> # v4.1.0` in one file and the same SHA as `# v9.9.9` in another collapse
  // to a single check, so whichever loses the collision is never verified. That is the failure this
  // scan exists to catch — a reference asserting something the remote does not say — surviving
  // inside the scan that checks for it.
  //
  // The extra probe this costs happens only when one SHA carries two different claims, which is
  // precisely the case that must not be skipped.
  const unique = [
    ...new Map(references.map((entry) => [referenceKey(entry), entry])).values(),
  ].filter((entry) => entry.kind === 'action');
  const results = new Array(unique.length);
  let next = 0;
  const worker = async () => {
    for (;;) {
      const index = next++;
      if (index >= unique.length) return;
      const reference = unique[index];
      let resolution;
      try {
        resolution = await probe(reference);
      } catch (error) {
        resolution =
          error instanceof RepositoryMissingError
            ? { status: 'repo-missing' }
            : { status: 'unreachable', detail: oneLine(error.message ?? error) };
      }
      results[index] = {
        reference,
        resolution,
        finding: classifyResolution(reference, resolution),
      };
    }
  };
  await Promise.all(
    Array.from({ length: Math.max(1, Math.min(PROBE_CONCURRENCY, unique.length)) }, worker),
  );
  return results;
}

/**
 * One finding per OCCURRENCE, from one verdict per unique reference. `vercel/action@v1` sits on two
 * lines of `deploy.yml`; reporting it once names one of them and leaves the other unmentioned, which (allow-missing-artifact: INFRA-058 deleted it; kept as the measured case)
 * is the same under-reporting of its own subject that the parser counter above fences.
 */
export function expandFindings(references, results) {
  // Keyed exactly as `resolveAll` keys its probes. Keying on `raw` alone here undoes that
  // disambiguation one step later: two occurrences sharing a SHA with different `# vX` claims yield
  // two verdicts, the map keeps one, and BOTH occurrences are then reported with it — so a
  // correctly-annotated line is told it claims a tag it does not, and the genuinely wrong line is
  // described by someone else's verdict. Wrong attribution is worse than a missed finding: it sends
  // the reader to a file that is fine.
  const byReference = new Map(
    results.filter((result) => result.finding).map((r) => [referenceKey(r.reference), r]),
  );
  return references.flatMap((reference) => {
    const hit = byReference.get(referenceKey(reference));
    if (!hit || reference.kind !== 'action') return [];
    return [{ where: `${reference.file}:${reference.line}`, detail: hit.finding.detail }];
  });
}

/** The identity a verdict belongs to: the reference AND what its comment claims about it. */
function referenceKey(reference) {
  return `${reference.raw} ${reference.claimedTag ?? ''}`;
}

/**
 * The line an OFF run owes its reader, or `null` when the live half ran.
 *
 * Never a silent skip: the one thing this scan exists to check did not happen on this run, and the
 * line says so in the words of the defect rather than in the words of a flag.
 *
 * HARNESS-052, reachability axis: saying it was not enough. The live half is off locally AND off
 * when `GITHUB_BASE_REF` is `main`, and `harness:scan` is the only path that runs this scan in
 * either place — where `run-all-scans` discards a passing scan's stdout. So the sentence "an action
 * that does not exist passes this run" was itself unreadable on every run that printed it, which is
 * the same shape as the reference it warns about. `ADVISORY_MARKER` (HARNESS-053) survives the 0
 * exit and reaches the summary; it cannot change the verdict, which is what keeps a github.com
 * outage from blocking a promotion.
 */
export function unverifiedResolvabilityLine(mode, unique) {
  if (mode.live) return null;
  return (
    `  ${ADVISORY_MARKER} RESOLVABILITY NOT VERIFIED on this run (${mode.why}): ${unique} ` +
    `reference(s) were parsed but none was resolved. An action that does not exist passes this run.`
  );
}

export async function main(argv = process.argv.slice(2)) {
  const write = (line) => process.stdout.write(`${line}\n`);
  const sources = readWorkflowSources();
  const findings = findStaticFindings(sources);
  const references = sources.flatMap((entry) => entry.references);
  const unique = new Set(
    references.filter((entry) => entry.kind === 'action').map((entry) => entry.raw),
  ).size;
  const lines = sources.reduce((sum, entry) => sum + entry.usesLineCount, 0);
  const mode = liveModeFor(argv);

  let results = [];
  if (mode.live && findings.length === 0) {
    results = await resolveAll(references);
    findings.push(...expandFindings(references, results));
  }

  if (findings.length > 0) {
    write(`action-references scan FAILED (INFRA-059) — ${findings.length} finding(s):`);
    // A GitHub outage reddens every reference at once; the count above is the honest total and the
    // tail is elided rather than dropped, so a real defect can never hide behind an outage's volume.
    for (const finding of findings.slice(0, MAX_REPORTED)) {
      write(`  - ${finding.where}: ${finding.detail}`);
    }
    if (findings.length > MAX_REPORTED) {
      write(`  … and ${findings.length - MAX_REPORTED} more finding(s) not printed`);
    }
    process.exitCode = 1;
    return;
  }

  write(
    `::examined:: ${sources.length} workflow files\n` +
      `action-references scan passed: ${unique} unique reference(s) over ${lines} \`uses:\` line(s) in ${sources.length} workflow(s).`,
  );
  for (const { reference, resolution } of results) {
    write(
      `  ✓ ${reference.raw} → ${resolution.sha.slice(0, 12)} (${resolution.refName ?? 'commit'})`,
    );
  }
  const branchPinned = results.filter((r) => r.resolution.refName?.startsWith('refs/heads/'));
  if (branchPinned.length > 0) {
    write(
      `  note: ${branchPinned.length} reference(s) resolve through a branch head, not a tag — a moving pointer that still resolves (HARNESS-055).`,
    );
  }
  const unverified = unverifiedResolvabilityLine(mode, unique);
  if (unverified !== null) write(unverified);
}

if (path.resolve(process.argv[1] ?? '') === path.resolve(import.meta.filename)) {
  await main();
}
