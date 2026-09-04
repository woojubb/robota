import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  asList,
  asScalar,
  frontmatterObject,
  isBlank,
  parseFrontmatterBlock,
  splitFrontmatter,
  unquote,
} from '../frontmatter.mjs';

/**
 * HARNESS-046 — the ANTI-FORK FLOOR.
 *
 * HARNESS-044 (#1380) fixed one scan's single-line-only frontmatter regex. The same assumption was
 * forked into three more scans, each with its own hand-rolled regex, so the fix did not travel. The
 * root class is duplication, and per the recurring-mistake-prevention principle a recurring mistake
 * is closed by a MECHANISM, not by fixing the instance: exactly one module may own the
 * `^<key>:` frontmatter regex, and this test fails the build when a second one appears.
 *
 * It reads the harness scripts from disk, so planting a hand-rolled frontmatter regex in any harness
 * script turns it red — that is the floor's own red-proof.
 */

const HARNESS_DIR = fileURLToPath(new URL('..', import.meta.url));

/** SEC-004 timing floor: the fixed scan is sub-millisecond, the pre-fix one took 14.5 s. */
const REDOS_BUDGET_MS = 250;
const REDOS_RED_TIMEOUT_MS = 120_000;

/** The one module allowed to own the frontmatter key regex. */
const SSOT_MODULE = 'frontmatter.mjs';

/**
 * Scripts still carrying their own frontmatter regex, each with a REASON (a reason-less entry is
 * itself a failure — the anti-rot rule this repo applies to every suppression list).
 */
const ALLOWLIST = new Map([
  [
    'check-backlog-placement.mjs',
    'HARNESS-046: reads only the `status`/`completed` scalars, which prettier never reflows, so it is ' +
      'latent rather than live; the file was under concurrent edit when HARNESS-046 landed. Convert it ' +
      'to frontmatter.mjs and delete this entry.',
  ],
]);

/**
 * Regex literals in a source file, as their raw pattern text.
 *
 * SEC-004 (`js/redos`): the character-class body was `(?:\\.|[^\]])*`, whose two branches both match
 * a backslash — `\\.` takes it with the character after it, `[^\]]` takes it alone. A run of
 * backslashes inside a `[…]` that never closes therefore has 2^n parses, and the engine tries all of
 * them before failing: 42 backslashes took 14.5 s. Excluding the backslash from the second branch
 * (`[^\]\\]`) makes exactly one branch match at every position, so the run is scanned once. Inside a
 * regex character class a backslash always begins an escape, so `\\.` already covers every
 * well-formed input and the extracted literals are unchanged.
 */
function regexLiterals(source) {
  // A regex literal: `/pattern/flags`, not preceded by an identifier/`)`/`]` (which would make `/`
  // a division), and not a `//` comment or a `/*` block opener.
  const literals = [];
  const pattern =
    /(^|[=(,:[!&|?{};+\-*%<>~^\s])\/((?:\\.|\[(?:\\.|[^\]\\])*\]|[^/\\\n[])+)\/[dgimsuvy]*/g;
  for (const match of source.matchAll(pattern)) literals.push(match[2]);
  return literals;
}

/**
 * Does this regex source read a YAML frontmatter key? Two shapes, both anchored at line start:
 *   - a generic key capture:  `^([A-Za-z_]+):`, `^\s*([A-Za-z0-9_-]+):\s*(.*)$`
 *   - a named frontmatter key: `^status:\s*(\S+)`, `^name:\s*(.+)$`
 */
const FRONTMATTER_KEYS = [
  'status',
  'completed',
  'name',
  'description',
  'tools',
  'signal',
  'type',
  'tags',
  'title',
  'capability',
  'created',
  'priority',
  'urgency',
  'area',
  'depends_on',
  'children',
  'related',
  'user_execution',
  'user_execution_scenario',
  // Added when a fork slipped past this guard: a scan hand-rolled `^loop:\s*(.+)$` and the list did
  // not name `loop`, so the named-key branch returned false and the anti-fork check passed on a fork.
  // An allowlist of key names is only as good as its newest entry — when a frontmatter key is
  // introduced, it belongs here in the same change.
  'loop',
  'owner',
];

export function isFrontmatterKeyRegex(source) {
  const anchored = /^\^(\\s\*)?/.exec(source);
  if (!anchored) return false;
  const rest = source.slice(anchored[0].length);
  // `([A-Za-z_]+):`, `([A-Za-z_][A-Za-z0-9_-]*):`, `[A-Za-z]+:` — one or more letter classes then `:`.
  const genericKeyCapture = /^\(?(?:\?:)?(?:\[A-Za-z[^\]]*\][+*?]?)+\)?:/;
  if (genericKeyCapture.test(rest)) return true;
  const named = /^([A-Za-z_][A-Za-z0-9_-]*):/.exec(rest);
  return named ? FRONTMATTER_KEYS.includes(named[1]) : false;
}

/**
 * Every harness SCRIPT. `__tests__` is excluded on purpose: a test legitimately writes regexes as
 * fixtures (this file does), and a scan's parsing truth lives in the script, never in its test.
 */
function harnessScripts() {
  const out = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir)) {
      const full = path.join(dir, entry);
      if (statSync(full).isDirectory()) {
        if (entry !== 'node_modules' && entry !== '__tests__') walk(full);
      } else if (entry.endsWith('.mjs')) {
        out.push(full);
      }
    }
  };
  walk(HARNESS_DIR);
  return out;
}

describe('HARNESS-046 anti-fork floor — one frontmatter parser', () => {
  it('detects hand-rolled frontmatter regexes (the detector itself)', () => {
    // The four real forks this backlog item removed, plus the SSOT's own pattern.
    expect(isFrontmatterKeyRegex('^([A-Za-z_]+):\\s*(.*)$')).toBe(true);
    expect(isFrontmatterKeyRegex('^([A-Za-z0-9_-]+):\\s?(.*)$')).toBe(true);
    expect(isFrontmatterKeyRegex('^([A-Za-z_][A-Za-z0-9_-]*):(.*)$')).toBe(true);
    expect(isFrontmatterKeyRegex('^status:\\s*(\\S+)')).toBe(true);
    expect(isFrontmatterKeyRegex('^name:\\s*(\\S+)\\s*$')).toBe(true);
    expect(isFrontmatterKeyRegex('^\\s*tags:\\s*(.+)$')).toBe(true);

    // A fork that slipped past this floor, and the reason it did: the named-key branch consults an
    // ALLOWLIST, so a scan hand-rolling `^loop:` was judged "not a frontmatter regex" and the floor
    // passed on a real fork. An allowlist is only as good as its newest entry — this pins the two
    // keys added with it, so losing them fails here rather than silently reopening the hole.
    expect(isFrontmatterKeyRegex('^loop:\\s*(.+)$')).toBe(true);
    expect(isFrontmatterKeyRegex('^owner:\\s*(\\S+)')).toBe(true);

    // Not frontmatter readers — the floor must not fire on ordinary harness regexes.
    expect(isFrontmatterKeyRegex('^\\s*import\\s')).toBe(false);
    expect(isFrontmatterKeyRegex('^#{1,6}\\s+(.*)$')).toBe(false);
    expect(isFrontmatterKeyRegex('([A-Za-z_]+):\\s*(.*)$')).toBe(false);
    expect(isFrontmatterKeyRegex('^- \\[(x| )\\]')).toBe(false);
    expect(isFrontmatterKeyRegex('^https?:')).toBe(false);
  });

  it('no harness script outside frontmatter.mjs hand-rolls a frontmatter key regex', () => {
    const offenders = [];
    for (const file of harnessScripts()) {
      const relative = path.relative(HARNESS_DIR, file);
      if (relative === SSOT_MODULE) continue;
      if (ALLOWLIST.has(relative)) continue;
      const hits = regexLiterals(readFileSync(file, 'utf8')).filter(isFrontmatterKeyRegex);
      if (hits.length > 0) offenders.push(`${relative}: /${hits.join('/, /')}/`);
    }

    expect(
      offenders,
      `Hand-rolled frontmatter regex found outside scripts/harness/${SSOT_MODULE}. Import ` +
        `parseFrontmatterBlock / splitFrontmatter / frontmatterObject from './frontmatter.mjs' ` +
        `instead — a forked per-line regex silently mis-reads prettier-wrapped values (HARNESS-044 ` +
        `/ #1369).\n  ${offenders.join('\n  ')}`,
    ).toEqual([]);
  });

  it('every allowlist entry names an existing file and carries a reason', () => {
    for (const [file, reason] of ALLOWLIST) {
      expect(() => statSync(path.join(HARNESS_DIR, file))).not.toThrow();
      expect(reason.length).toBeGreaterThan(40);
    }
  });

  it(
    'SEC-004: an unclosed character class full of backslashes is scanned in linear time',
    () => {
      // The catastrophic shape: `[` opens a class, a run of backslashes follows, and no `]` ever
      // arrives — so every one of the 2^n ways to split that run gets tried before the match fails.
      // 42 backslashes cost 14.5 s against the pre-fix pattern and 0.1 ms against this one.
      const source = ` /[${'\\'.repeat(42)}!`;
      const started = performance.now();
      expect(regexLiterals(source)).toEqual([]);
      expect(performance.now() - started).toBeLessThan(REDOS_BUDGET_MS);
    },
    REDOS_RED_TIMEOUT_MS,
  );

  it('SEC-004: extracts the same literals as before, character classes included', () => {
    // A class holding an escaped `]`, an escaped `\`, and a `/` — the cases the class branch exists
    // for. Each must still be read as ONE literal, ending at the real closing delimiter.
    expect(regexLiterals('const a = /[^\\]]+/g;')).toEqual(['[^\\]]+']);
    expect(regexLiterals('const b = /[\\\\/]+/;')).toEqual(['[\\\\/]+']);
    expect(regexLiterals('const c = /a\\/b/;')).toEqual(['a\\/b']);
    expect(regexLiterals('const d = /^\\s*tags:\\s*(.+)$/;')).toEqual(['^\\s*tags:\\s*(.+)$']);
    expect(regexLiterals('const e = /[a-z]/ + /[0-9]/;')).toEqual(['[a-z]', '[0-9]']);
    // Not literals: a division and a comment.
    expect(regexLiterals('const f = total / count;')).toEqual([]);
  });

  it('the converged scans import the SSOT parser', () => {
    for (const script of [
      'check-spec-doc-frontmatter.mjs',
      'scan-capability-reachability.mjs',
      'check-agent-def-convention.mjs',
      'scan-orchestration-map.mjs',
    ]) {
      const source = readFileSync(path.join(HARNESS_DIR, script), 'utf8');
      expect(source, `${script} must read frontmatter through ./frontmatter.mjs`).toContain(
        "from './frontmatter.mjs'",
      );
    }
  });
});

describe('HARNESS-046 SSOT parser — the forms this repo produces', () => {
  const WRAPPED = [
    '---',
    'status: draft',
    'tags:',
    '  [',
    '    architecture,',
    '    harness,',
    '  ]',
    'completed: 2026-07-25',
    '---',
    '',
    'body text',
  ].join('\n');

  it('parses scalars, wrapped arrays, and the keys that follow them', () => {
    const fm = frontmatterObject(WRAPPED);
    expect(fm.status).toBe('draft');
    expect(fm.tags).toEqual(['architecture', 'harness']);
    expect(fm.completed).toBe('2026-07-25');
  });

  it('parses inline flow arrays, block sequences, and wrapped scalars', () => {
    expect(frontmatterObject('---\ntags: [a, b]\n---\n').tags).toEqual(['a', 'b']);
    expect(frontmatterObject('---\ntags:\n  - a\n  - b\n---\n').tags).toEqual(['a', 'b']);
    expect(frontmatterObject('---\nkey:\n  wrapped-value\n---\n').key).toBe('wrapped-value');
  });

  it('parses folded and literal block scalars', () => {
    expect(
      frontmatterObject('---\ndescription: >-\n  line one\n  line two\n---\n').description,
    ).toBe('line one line two');
    expect(
      frontmatterObject('---\ndescription: |\n  line one\n  line two\n---\n').description,
    ).toBe('line one\nline two');
  });

  it('strips one layer of quotes from a scalar but never mangles quoted prose', () => {
    expect(unquote('"x"')).toBe('x');
    expect(unquote("'x'")).toBe('x');
    expect(unquote('"a" and "b"')).toBe('"a" and "b"');
    expect(frontmatterObject('---\npath: ".agents/x.md"\n---\n').path).toBe('.agents/x.md');
  });

  it("reads YAML's doubled-apostrophe escape inside a single-quoted scalar (#2298)", () => {
    // `'it''s'` is the only way YAML spells an apostrophe inside single quotes, and it is what the
    // task allocator writes. A lone interior apostrophe is not an escape and stays untouched.
    expect(unquote("'PROC-015: an issue''s resolution'")).toBe("PROC-015: an issue's resolution");
    expect(unquote("'a''b''c'")).toBe("a'b'c");
    expect(unquote("'it's'")).toBe("'it's'");
    // The escape belongs to single quotes only: inside double quotes a doubled apostrophe is text.
    expect(unquote('"it\'\'s"')).toBe("it''s");
    expect(frontmatterObject("---\ntitle: 'X-001: an issue''s fix'\n---\n").title).toBe(
      "X-001: an issue's fix",
    );
  });

  it('returns null / {} for text with no frontmatter block', () => {
    expect(parseFrontmatterBlock('# just a heading\n')).toBeNull();
    expect(frontmatterObject('# just a heading\n')).toEqual({});
    expect(parseFrontmatterBlock('---\nno closing fence\n')).toBeNull();
  });

  it('splits the body from the frontmatter, CRLF included', () => {
    expect(splitFrontmatter(WRAPPED).body).toBe('\nbody text');
    const crlf = splitFrontmatter('---\r\nname: x\r\n---\r\n\r\nbody\r\n');
    expect(crlf.entries.get('name')).toBe('x');
    expect(crlf.body).toBe('\nbody\n');
    expect(splitFrontmatter('no fm\n').body).toBe('no fm\n');
  });

  it('coerces values with asScalar / asList / isBlank', () => {
    expect(asScalar(['a', 'b'])).toBe('a, b');
    expect(asScalar(undefined)).toBe('');
    expect(asList('a')).toEqual(['a']);
    expect(asList(undefined)).toEqual([]);
    expect(isBlank(undefined)).toBe(true);
    expect(isBlank([])).toBe(true);
    expect(isBlank('')).toBe(true);
    expect(isBlank('a')).toBe(false);
  });
});
