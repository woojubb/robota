#!/usr/bin/env node
/**
 * SEC-016 — a hook event that claims to ENFORCE must have a fire site that can honour it.
 *
 * ## What this exists to catch
 *
 * `HOOK_ENFORCEMENT_POLICY` records a posture per lifecycle event. Measured when it was written: of
 * the sixteen `THookEvent` members, exactly ONE — `PreToolUse` — has a fire site that awaits
 * `runHooks` and consults `blocked`. The other fifteen are advisory by construction, not by
 * decision: seven fire `void`, five are called without `await`, and three await a result they never
 * inspect.
 *
 * So the table is fifteen-sixteenths unreachable, and flipping any of those rows to `enforcing`
 * changes NOTHING at runtime while reading as though a gate had been switched on. No behavioural
 * test catches that: every enforcement test drives `PreToolUse`, and the one advisory-events test is
 * a NEGATIVE assertion ("no denial, no thrown error") that the mutated table satisfies. This scan is
 * what stands there.
 *
 * The table's other contradiction — `posture: 'enforcing'` with `enforcementReachable: false` — is
 * caught by `assertPolicyCoherent` in the policy module itself, deliberately without needing this
 * scan. Two independent checks, because whichever one is skipped would otherwise be the only thing
 * standing between the two fields.
 *
 * ## Why it fails closed three ways
 *
 * A scan that reports green having checked nothing is the defect it was built to prevent, one layer
 * up. `.github/workflows/ci.yml` (INFRA-058) records the measured instance in this repository:
 * `set -e` does not fire on a command substitution used as a word-list, so an unresolvable range
 * produced an empty list, the loop body never ran, and a REQUIRED check reported green having linted
 * nothing. It now fails on an unresolvable range AND on a range that resolves but is empty. This
 * scan copies both arms and adds more. Every finding code it can emit, because an earlier version of
 * this list named three and the code emitted nine — a list that claims to enumerate is a claim, and
 * three of the codes it omitted were arms no reader would know to look for:
 *
 *   - `[policy-row-not-parsed]`      a row the parser could not read at all → FAIL, never skipped
 *   - `[policy-row-unknown-event]`   a parsed row naming an event outside the union
 *   - `[unresolved-policy-row]`      a row whose posture the parser could not resolve
 *   - `[unreadable-event-union]`     the `THookEvent` union itself could not be read
 *   - `[no-enforcing-rows]`          zero `enforcing` rows; a table with nothing to check is
 *                                    degenerate, not clean
 *   - `[unresolvable-fire-site]`     an `enforcing` row with no resolvable fire site
 *   - `[inert-enforcing-row]`        an `enforcing` row whose fire site does not await and read
 *                                    `blocked`
 *   - `[stale-reachability]`         `enforcementReachable` disagrees with what the fire sites show
 *   - `[reachability-contradiction]` a row that is `enforcing` while `enforcementReachable` is false
 *
 * Note what this scan does NOT reach, because the boundary matters more than the list: it checks the
 * `blocked` path only. Deleting the `isEnforcing('PreToolUse')` block in `tool-hook-helpers.ts`
 * leaves this scan green — that gate is held by unit tests, not by here.
 *
 * Usage: `node scripts/harness/scan-hook-enforcement-reachable.mjs [--policy <path>] [--src <dir>]`
 * Exit 0 = every enforcing row is honoured by its fire site. Exit 1 = otherwise.
 */

import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

import { enumerateFiles } from './enumerate-files.mjs';

const WORKSPACE_ROOT = path.resolve(import.meta.dirname, '../..');

/**
 * What the last run actually read.
 *
 * Set inside the traversals rather than derived afterwards, per `measurement-provenance.md`: a size
 * recomputed for the report is a second measurement that agrees on the day it is written. Exported
 * so a test can assert them — a self-reported number nothing checks is the shape this whole item is
 * about.
 */
let examinedRows = 0;
let examinedFireSites = 0;

/** Policy rows the last `collectPolicyRows` actually parsed. */
export function examinedRowCount() {
  return examinedRows;
}

/** Non-test `runHooks` fire sites the last `findFireSites` walk actually read. */
export function examinedFireSiteCount() {
  return examinedFireSites;
}
const DEFAULT_POLICY = 'packages/agent-core/src/hooks/enforcement-policy.ts';

/** Where a `runHooks` call was found, and what the surrounding code does with its result. */
/** @typedef {{ file: string, line: number, events: string[], awaited: boolean, readsBlocked: boolean }} TFireSite */

/**
 * Is the `/` at `index` the start of a regex literal rather than division?
 *
 * The classic ambiguity, resolved the standard way: a regex may begin only where a VALUE may begin.
 * After an identifier, a number, a string, `)` or `]`, a `/` is division. A heuristic, not a parser.
 *
 * Its failure direction is PERMISSIVE, and that is stated here rather than in the caller because an
 * earlier revision claimed the opposite. The regex branch in `blankComments` only advances the
 * cursor — it never blanks — so a `/` that is really division, taken for a regex, causes the span to
 * the next `/` to be SKIPPED. A `//` inside that span then never starts a comment, and the comment
 * survives as code. See the limitation list on `blankComments`; contained under #2258.
 */
function startsRegexLiteral(source, index) {
  let j = index - 1;
  while (j >= 0 && /\s/.test(source[j])) j -= 1;
  if (j < 0) return true;
  const prev = source[j];
  if (/[A-Za-z0-9_$)\]]/.test(prev)) {
    // ...unless the identifier is a keyword that can precede a value.
    let k = j;
    while (k >= 0 && /[A-Za-z]/.test(source[k])) k -= 1;
    const word = source.slice(k + 1, j + 1);
    return ['return', 'typeof', 'case', 'in', 'of', 'do', 'else', 'yield', 'await'].includes(word);
  }
  return true;
}

/**
 * Replace every comment byte with a space, preserving offsets and line structure.
 *
 * Offset-PRESERVING on purpose: `lineOffsets`, `enclosingBlockStart`, `bodyEnd` and `pushWindow` all
 * index into the same buffer, so collapsing a comment would shift every position after it. The
 * repository's `stripComments` collapses, which is why this is local rather than a reuse.
 *
 * String and regex literals are SKIPPED so a `//` or an unbalanced quote inside one cannot start a
 * false comment. Skipped, not blanked — that distinction is the whole of the limitations below.
 *
 * Contained — #2258. What this does NOT do, stated as a list because an earlier revision of it
 * omitted the one construct that issue names, and because three separate numbers attached to these
 * paragraphs have since been measured wrong:
 *
 *   1. **Braces inside string and template literals are not neutralised.** They are skipped, so
 *      `enclosingBlockStart` and `bodyEnd` count a `{` inside an ordinary message string as a real
 *      brace. 19 production files carry such a literal today (AST-measured, base and head).
 *   2. **A misfire of the division-versus-regex heuristic fails PERMISSIVE, not conservative.** The
 *      regex branch only advances the cursor; it never blanks. So when a `/` that is really division
 *      is taken for a regex, the span to the next `/` is skipped, and a `//` inside that span never
 *      starts a comment — the comment survives as CODE. A previous revision of this docblock claimed
 *      the opposite ("shrinks a window rather than widening it… fails conservative"); that was
 *      inverted. Live instances: 0 of the enumerated production files, so latent rather than active.
 *   3. JSX is not handled.
 *
 * Whether to blank literals rather than skip them is #2258's open question and is not decided here.
 * The sibling `scan-hook-catalog.mjs` states the same brace limitation plainly; this file used to
 * deny it.
 *
 * On the evidence that used to live here: several end-to-end demonstrations were attached to these
 * limitations and did not reproduce — one claimed a message string ending in `{` flips the scan to
 * exit 0 (408 cases were run against that; none do), another named `/\/dist\//` as the idiom that
 * produced a pre-fix exit 0 (it does not; a regex containing a QUOTE does, by opening a phantom
 * string that swallows the following comment). The limitations are real and are what the list above
 * states; the demonstrations were not, and are removed rather than restated.
 */
export function blankComments(source) {
  const out = source.split('');
  let i = 0;
  const blank = (from, to) => {
    for (let k = from; k < to && k < out.length; k++) if (out[k] !== '\n') out[k] = ' ';
  };
  while (i < source.length) {
    const two = source.slice(i, i + 2);
    if (two === '//') {
      const end = source.indexOf('\n', i);
      blank(i, end === -1 ? source.length : end);
      i = end === -1 ? source.length : end;
    } else if (two === '/*') {
      const end = source.indexOf('*/', i + 2);
      const stop = end === -1 ? source.length : end + 2;
      blank(i, stop);
      i = stop;
    } else if (source[i] === '/' && startsRegexLiteral(source, i)) {
      // A REGEX LITERAL, not a comment and not division. Without this branch the `//` inside the
      // trailing `//` of a regex such as `/\/dist\//` reads as a line comment and blanks the REST
      // OF THAT LINE OF LIVE CODE, including a closing `]` or `}`. No corpus count is given here on
      // purpose: three different numbers have been attached to this paragraph and measured wrong,
      // each by a different method. The limitation is what matters and it does not need a count.
      // A blanked unmatched brace makes `bodyEnd` run past its function, which is the permissive
      // direction: an unrelated later function then answers for this one. Measured end to end —
      // with the `blocked` gate deleted and one regex-carrying line added, the scan reported every
      // enforcing row honoured, exit 0.
      i += 1;
      let inClass = false;
      while (i < source.length) {
        const c = source[i];
        if (c === '\\') {
          i += 2;
          continue;
        }
        if (c === '[') inClass = true;
        else if (c === ']') inClass = false;
        else if (c === '/' && !inClass) break;
        else if (c === '\n') break; // unterminated; treat as not-a-regex rather than eating the file
        i += 1;
      }
      i += 1;
    } else if (source[i] === "'" || source[i] === '"' || source[i] === '`') {
      const quote = source[i];
      i += 1;
      while (i < source.length && source[i] !== quote) {
        if (source[i] === '\\') i += 1;
        i += 1;
      }
      i += 1;
    } else {
      i += 1;
    }
  }
  return out.join('');
}

/**
 * Index of the `{` opening the innermost block that CONTAINS `offset`.
 *
 * Pairs with `bodyEnd` to bound a search to one function body. Without it, `readsBlocked` searched
 * `source.slice(source.indexOf(text))` — from the FIRST textual occurrence of the call line to the
 * end of the file — so two identically-spelled call lines made the second read the first's window,
 * and any later function whose variable happened to share the name and read `.blocked` vouched for
 * this site. Both errors were permissive, in a scan whose whole purpose is to refuse a fire site
 * that does not honour an enforcing row.
 *
 * A mis-bounded window here is too SMALL rather than too large, so the failure direction is
 * `readsBlocked: false` — which makes an enforcing row fail loudly instead of passing quietly.
 *
 * That holds for the WINDOW ARITHMETIC ONLY, and the qualification is load-bearing rather than
 * cautious. Twice now the direction has inverted for a reason outside the arithmetic: while
 * `blankComments` mis-read a regex literal as a comment, blanking an unmatched bracket let the walk
 * run past its own function; and today, because literals are skipped rather than neutralised, a `{`
 * inside an ordinary message string is counted as a real brace and does the same. That second one
 * is contained under issue #2258 rather than fixed here.
 *
 * An earlier revision attached an end-to-end demonstration to that sentence — "one added string
 * takes the scan from `[inert-enforcing-row]` to exit 0". It does not reproduce; 408 cases were run
 * against it and none go green, because once the gate is deleted no un-blanked occurrence of the
 * symbol remains for any window width to find. The limitation is real, the demonstration was not,
 * and it is removed rather than restated.
 *
 * So: do not read this as "the failure direction is safe". Read it as "the arithmetic does not widen
 * the window; the primitive underneath it can, and every helper here inherits that."
 */
function enclosingBlockStart(source, offset) {
  let depth = 0;
  for (let i = offset; i >= 0; i--) {
    if (source[i] === '}') depth++;
    else if (source[i] === '{') {
      if (depth === 0) return i;
      depth--;
    }
  }
  return 0;
}

/**
 * Does the code that CONTAINS `lineOffset` read `<assigned>.blocked`?
 *
 * Exported because this is the unit that carried the defect and `findFireSites` enumerates from the
 * workspace root, so the end-to-end path cannot be driven from a temporary fixture. Testing the
 * enclosing-block helper alone would test a proxy; this takes the real source text and answers the
 * real question.
 */
export function readsBlockedInScope(rawSource, lineOffset, assigned) {
  if (assigned === undefined) return false;
  // Blanked here too, so the exported unit is correct when called directly. Idempotent: blanking a
  // buffer that is already blanked changes nothing, and offsets are preserved either way.
  const source = blankComments(rawSource);
  const start = enclosingBlockStart(source, lineOffset);
  const scope = source.slice(start, bodyEnd(source, start));
  return new RegExp(`\\b${assigned}\\.blocked\\b`).test(scope);
}

/** Index just past the `}` that closes the block opening at `start`. */
function bodyEnd(source, start) {
  let depth = 0;
  for (let i = start; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}' && --depth === 0) return i + 1;
  }
  return source.length;
}

/**
 * Collect the posture table's rows out of the policy module.
 *
 * Named `collect…` rather than `parse…` because `scan-measurement-provenance.mjs` resolves a counter's
 * finder by that prefix — a reader with no recognisable finder is a size nothing can be shown to
 * move. The name also describes it better: it gathers rows, and reports how many it gathered.
 *
 * Read as TEXT rather than imported: the scan must judge the file as committed, and an import would
 * execute `assertPolicyCoherent`'s module-level siblings and couple this check to the build. Parsing
 * is also what lets a deliberately-broken fixture be passed via `--policy` for the scan's own tests.
 *
 * @returns {{ entries: Map<string, {posture: string, reachable: boolean}>, helpers: Set<string> }}
 */
export function collectPolicyRows(policyPath) {
  // Blank comments before parsing: a commented-out row otherwise overrides the real one, because a
  // later inline match wins. Measured — a `/* … */` block holding an `enforcing` PreToolUse row made
  // the scan report the gate armed while the real row said advisory.
  const source = blankComments(readFileSync(policyPath, 'utf8'));

  // Helper-constructed rows (`firesAndForgets(...)`, `awaitsButIgnoresBlocked(...)`) are advisory by
  // the helper's own definition; the helpers are read so a renamed or added one is not silently
  // treated as an unparsed row.
  const helpers = new Set(
    [...source.matchAll(/function\s+(\w+)\s*\([^)]*\)\s*:\s*IHookEventPolicy/g)].map((m) => m[1]),
  );

  const entries = new Map();

  // Inline object rows: `EventName: { posture: '…', enforcementReachable: …, … }`
  for (const match of source.matchAll(
    /^\s{4}(\w+):\s*\{\s*[\s\S]*?posture:\s*'(\w+)',\s*[\s\S]*?enforcementReachable:\s*(true|false),/gm,
  )) {
    entries.set(match[1], { posture: match[2], reachable: match[3] === 'true' });
  }

  // Helper-constructed rows: `EventName: helperName(...)`.
  for (const match of source.matchAll(/^\s{4}(\w+):\s*(\w+)\(/gm)) {
    const [, event, helper] = match;
    if (!helpers.has(helper) || entries.has(event)) continue;
    // Bounded to the helper's OWN body. Slicing to end-of-file let a helper resolve its posture
    // from the first matching literal anywhere below it — including the policy table's own rows —
    // so arm 1 could never fire. Review demonstrated a helper with neither field resolving from an
    // unrelated constant.
    const declaration = source.indexOf(`function ${helper}`);
    const bodyStart = source.indexOf('{', declaration);
    const body = declaration === -1 ? '' : source.slice(bodyStart, bodyEnd(source, bodyStart));
    const posture = /posture:\s*'(\w+)'/.exec(body)?.[1];
    const reachable = /enforcementReachable:\s*(true|false)/.exec(body)?.[1];
    if (posture === undefined || reachable === undefined) {
      // Arm 1: a row we cannot resolve is a failure, not a skip.
      entries.set(event, { posture: 'UNRESOLVED', reachable: false });
      continue;
    }
    entries.set(event, { posture, reachable: reachable === 'true' });
  }

  examinedRows = entries.size;
  return { entries, helpers };
}

/**
 * Every non-test `runHooks(` call in the workspace, with what its caller does with the result.
 *
 * Enumeration goes through `enumerate-files.mjs`, the harness's single owner of "which files does a
 * scan judge" (INFRA-121). It counts untracked files too, which matters here: a scan that judged
 * only the git index would report clean on a policy or fire site that had not been `git add`ed yet.
 */
/**
 * Trees that are NOT the product, and must not vouch for it.
 *
 * Review found the defect this closes: excluding only `__tests__` left
 * `packages/agent-session/examples/verify-hook-outcome-contract.ts` counted as a fire site. It
 * awaits `runHooks(…, 'PreToolUse', …)` and reads `.blocked` — because it is a demonstration OF the
 * gate — so arm 3 was satisfied by it. Deleting the entire production gate left this scan green: a
 * demo script vouching for something that no longer existed.
 *
 * The honesty requirement is that a row claiming to enforce points at code the PRODUCT runs. A path
 * under `src/` that is not a test is that; an example, a fixture, or built output is not.
 */
const NON_PRODUCTION = [
  /\/__tests__\//,
  /\.test\.ts$/,
  /\/examples?\//,
  /\/dist\//,
  /\/fixtures?\//,
  /\/testing\//,
];

/** Is this path product source — the code a user's session actually runs? */
export function isProductionSource(relative) {
  if (NON_PRODUCTION.some((pattern) => pattern.test(relative))) return false;
  // Positively require `src/`, rather than only excluding known non-product trees: a new sibling
  // directory should have to EARN inclusion, not be included until someone remembers to exclude it.
  return /^(packages|apps)\/[^/]+\/src\//.test(relative);
}

/**
 * Every `runHooks(` fire site in ONE source string.
 *
 * Exported for the same reason as `readsBlockedInScope`: `findFireSites` enumerates from the
 * workspace root via `git ls-files`, so the blanking it applies per file cannot be driven from a
 * temporary fixture, and the live corpus happens to contain no commented-out `runHooks(` — so
 * nothing exercised it. Extracting the per-source unit pins the behaviour without writing a fixture
 * file into `packages/`, where a parallel suite would see it.
 *
 * Takes RAW source and blanks it here, so the blanking is part of the unit under test.
 */
export function collectFireSitesFromSource(relative, rawSource) {
  /** @type {TFireSite[]} */
  const found = [];
  // Blanked, not raw: a commented-out `runHooks(` line otherwise creates a phantom fire site,
  // and a comment mentioning `<ident>.blocked` vouches for a gate that no longer exists.
  const source = blankComments(rawSource);
  if (!source.includes('runHooks(')) return found;
  const lines = source.split('\n');

  // Offset of the START of each line. `indexOf(text)` finds the first line that LOOKS like this
  // one, which is a different thing whenever two call sites are spelled identically.
  const lineOffsets = [];
  let running = 0;
  for (const line of lines) {
    lineOffsets.push(running);
    running += line.length + 1;
  }

  lines.forEach((text, index) => {
    if (!text.includes('runHooks(')) return;
    if (/export\s+async\s+function\s+runHooks/.test(text)) return; // the definition, not a site

    // The call's argument list may span lines; take a window generous enough to hold it.
    const window = lines.slice(index, index + 12).join('\n');
    const events = [
      ...window.matchAll(
        /'(Pre[A-Z]\w+|Post[A-Z]\w+|Session\w+|Stop\w*|UserPromptSubmit|Subagent\w+|Worktree\w+|PermissionDecision)'/g,
      ),
    ].map((m) => m[1]);

    // `blocked` is read from the result if the assignment's identifier is later used with it.
    const assigned = /(?:const|let)\s+(\w+)\s*=\s*await\s+runHooks\(/.exec(text)?.[1];
    const readsBlocked = readsBlockedInScope(source, lineOffsets[index], assigned);

    found.push({
      file: relative,
      line: index + 1,
      events,
      awaited: /await\s+runHooks\(/.test(text),
      readsBlocked,
    });
  });
  return found;
}

export function findFireSites(pathspecs) {
  /** @type {TFireSite[]} */
  const sites = [];

  for (const relative of enumerateFiles(pathspecs)) {
    if (!relative.endsWith('.ts')) continue;
    if (!isProductionSource(relative)) continue;
    const file = path.join(WORKSPACE_ROOT, relative);
    if (!existsSync(file)) continue;
    sites.push(...collectFireSitesFromSource(relative, readFileSync(file, 'utf8')));
  }
  examinedFireSites = sites.length;
  return sites;
}

/**
 * Every `THookEvent` member, read from the union rather than restated.
 *
 * The scan's arm-1 promise is "a row this scan cannot read is a row it did not check — failing
 * rather than skipping". Review showed that promise was false: three valid TypeScript spellings of a
 * row (fields reordered, `rationale` omitted, double quotes) slip past the inline regex, the row
 * simply vanishes, and the scan exits 0 having examined 15 of 16. Comparing the parsed set against
 * the union is what makes a dropped row loud.
 */
export function readEventUnion(root = WORKSPACE_ROOT) {
  const source = blankComments(
    readFileSync(path.join(root, 'packages/agent-core/src/hooks/types.ts'), 'utf8'),
  );
  const block = /export type THookEvent =([\s\S]*?);/.exec(source)?.[1];
  if (block === undefined) return null;
  return [...block.matchAll(/'([A-Za-z]+)'/g)].map((m) => m[1]);
}

export function evaluate(entries, sites, expectedEvents = readEventUnion()) {
  const findings = [];

  // Arm 0 — the parsed set must BE the union. A row the parser silently dropped is the failure
  // mode arm 1 claims to prevent and, before this, did not.
  if (expectedEvents === null) {
    findings.push(
      `[unreadable-event-union] could not read the THookEvent union from packages/agent-core/src/hooks/types.ts — failing rather than judging a policy against nothing.`,
    );
  } else {
    const missing = expectedEvents.filter((event) => !entries.has(event));
    const extra = [...entries.keys()].filter((event) => !expectedEvents.includes(event));
    if (missing.length > 0) {
      findings.push(
        `[policy-row-not-parsed] ${missing.join(', ')} — declared in THookEvent but no policy row was parsed for them. Either the row is absent, or it is spelled in a form this scan cannot read; both are unchecked rows, not clean ones.`,
      );
    }
    if (extra.length > 0) {
      findings.push(
        `[policy-row-unknown-event] ${extra.join(', ')} — a policy row naming something that is not a THookEvent member.`,
      );
    }
  }
  const enforcing = [...entries].filter(([, e]) => e.posture === 'enforcing');

  // Arm 1 — unresolved rows.
  for (const [event, entry] of entries) {
    if (entry.posture === 'UNRESOLVED') {
      findings.push(
        `[unresolved-policy-row] ${event}: its posture could not be parsed. A row this scan cannot read is a row it did not check — failing rather than skipping.`,
      );
    }
  }

  // Arm 2 — a table with nothing to check is degenerate, not clean.
  if (enforcing.length === 0) {
    findings.push(
      `[no-enforcing-rows] the policy declares no 'enforcing' event. A scan that checked nothing must not report clean (the commitlint empty-range precedent, .github/workflows/ci.yml).`,
    );
  }

  // Arm 3 — the claim each enforcing row makes about its fire site.
  for (const [event, entry] of enforcing) {
    const owning = sites.filter((s) => s.events.includes(event));
    if (owning.length === 0) {
      findings.push(
        `[unresolvable-fire-site] ${event} is declared 'enforcing' but no non-test runHooks call site naming it could be found. Failing rather than skipping.`,
      );
      continue;
    }
    const honoured = owning.filter((s) => s.awaited && s.readsBlocked);
    if (honoured.length === 0) {
      const where = owning.map((s) => `${s.file}:${s.line}`).join(', ');
      findings.push(
        `[inert-enforcing-row] ${event} is declared 'enforcing', but no fire site both awaits runHooks and reads .blocked (${where}). The posture asserts a gate the code cannot operate.`,
      );
    }
    if (!entry.reachable) {
      findings.push(
        `[reachability-contradiction] ${event} declares posture 'enforcing' with enforcementReachable: false.`,
      );
    }
  }

  // The recorded flag must not claim unreachable where the site plainly reaches.
  for (const [event, entry] of entries) {
    if (entry.posture !== 'advisory' || entry.reachable) continue;
    const owning = sites.filter((s) => s.events.includes(event));
    if (owning.some((s) => s.awaited && s.readsBlocked)) {
      findings.push(
        `[stale-reachability] ${event} records enforcementReachable: false, but its fire site awaits and reads .blocked. The flag is stale; the site changed under it.`,
      );
    }
  }

  return findings;
}

function main() {
  const argv = process.argv.slice(2);
  const policyArg = argv.indexOf('--policy');
  const policyPath = path.resolve(
    WORKSPACE_ROOT,
    policyArg === -1 ? DEFAULT_POLICY : argv[policyArg + 1],
  );
  if (!existsSync(policyPath)) {
    console.error(
      `hook-enforcement-reachable: policy module not found at ${policyPath}. Failing rather than reporting clean.`,
    );
    process.exit(1);
  }

  const { entries } = collectPolicyRows(policyPath);
  if (entries.size === 0) {
    console.error(
      `hook-enforcement-reachable: parsed zero policy rows from ${path.relative(WORKSPACE_ROOT, policyPath)}. A parse that found nothing is not a policy that is clean.`,
    );
    process.exit(1);
  }

  const srcArg = argv.indexOf('--src');
  const pathspecs = srcArg === -1 ? ['packages', 'apps'] : [argv[srcArg + 1]];
  const sites = findFireSites(pathspecs);
  if (sites.length === 0) {
    console.error(
      `hook-enforcement-reachable: found zero non-test runHooks fire sites under ${pathspecs.join(', ')}. An enumeration that found nothing is not a tree that is clean.`,
    );
    process.exit(1);
  }
  const findings = evaluate(entries, sites);

  console.log(
    `::examined:: ${examinedRowCount()} policy row(s), ${examinedFireSiteCount()} non-test runHooks fire site(s)`,
  );

  if (findings.length > 0) {
    for (const finding of findings) console.error(`- ${finding}`);
    console.error(`hook-enforcement-reachable scan FAILED (${findings.length} finding(s)).`);
    process.exit(1);
  }

  const enforcing = [...entries].filter(([, e]) => e.posture === 'enforcing').map(([n]) => n);
  console.log(
    `hook-enforcement-reachable scan passed — enforcing: ${enforcing.join(', ')}; every enforcing row has a fire site that awaits runHooks and reads .blocked.`,
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  main();
}
