import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { describe, expect, it } from 'vitest';

import { makeTemp } from './make-temp.mjs';

import {
  FLOORS_HEADING,
  collectDeclaration,
  decideLane,
  fileTouchesTriggerSection,
  findLaneFloors,
  globToRegExp,
  hunkHasCodeChange,
  isCommentOrBlankLine,
  parseLaneFloors,
  parseSpecTriggerSections,
  parseUnifiedDiff,
  readExamined,
} from '../scan-lane-declaration.mjs';

const SCAN_SCRIPT = fileURLToPath(new URL('../scan-lane-declaration.mjs', import.meta.url));
const RULE_FILE = fileURLToPath(
  new URL('../../../.agents/rules/spec-workflow.md', import.meta.url),
);

/**
 * A fixture copy of the two tables the scan derives its criteria from, in the exact shape
 * `spec-workflow.md` writes them. This is NOT a second implementation of the rule — the scan parses
 * the live rule at run time. It is the pin that fails when the table SHAPE changes without the
 * parser following, which is the failure mode a derived-criteria design trades for.
 */
const LIVE_SPEC_POLICY = `### Live Spec Policy

| What changed                                                   | SPEC section to update                  |
| -------------------------------------------------------------- | --------------------------------------- |
| New or removed public export                                   | Public API Surface                      |
| New or changed type or interface                               | Type Ownership                          |
| New class or \`implements\`/\`extends\` relation               | Class Contract Registry                 |
| New or changed error type or code                              | Error Taxonomy                          |
| New or changed lifecycle event                                 | State Lifecycle / Event Architecture    |
| New or changed **externally observable** behavior or semantics | Architecture Overview, relevant section |
| New extension point (abstract class, callback)                 | Extension Points                        |
`;

const LANE_FLOORS = `### HARD GATE: No Immediate Implementation

#### Lane floors

| Floor | Path pattern                                                | Why                                        |
| ----- | ----------------------------------------------------------- | ------------------------------------------ |
| L2    | \`packages/*/docs/SPEC.md#trigger-sections\`                | a contract change                          |
| L2    | \`.github/workflows/**\`, \`.claude/hooks/**\`              | repository-wide policy files               |
| L2    | \`.agents/rules/**\`, \`.agents/specs/gate-catalogue.md\`   | the gate rules themselves                  |
| L1    | \`scripts/**#non-comment\`                                  | tooling scripts — a non-comment change     |
| L1    | \`**/src/**\`                                               | a non-comment code change                  |
| L0    | everything else                                             | no contract, no code, no policy            |
`;

const RULE_TEXT = `# Spec Workflow Rules\n\n${LIVE_SPEC_POLICY}\n${LANE_FLOORS}\n### A Later Section\n\nprose\n`;

const FLOORS = parseLaneFloors(RULE_TEXT);
const TRIGGERS = parseSpecTriggerSections(RULE_TEXT);

/** A one-file unified diff over `filePath` with the given hunk body lines (each prefixed +/-/space). */
function diffFor(filePath, hunkLines, { newStart = 1, oldStart = 1 } = {}) {
  return [
    `diff --git a/${filePath} b/${filePath}`,
    `--- a/${filePath}`,
    `+++ b/${filePath}`,
    `@@ -${oldStart},${hunkLines.length} +${newStart},${hunkLines.length} @@`,
    ...hunkLines,
    '',
  ].join('\n');
}

const CODE_CHANGE = diffFor('packages/agents/src/index.ts', [
  ' export const a = 1;',
  '-export const b = 2;',
  '+export const b = 3;',
]);

const COMMENT_ONLY_CHANGE = diffFor('packages/agents/src/index.ts', [
  ' export const a = 1;',
  '-// old note',
  '+// new note',
  '+/**',
  '+ * a block comment',
  '+ */',
  '+',
]);

/**
 * A markdown bullet added INSIDE a template literal. Every line here starts with `* ` the way a
 * block-comment body line does, and none of it is a comment: it is a string the program ships.
 */
const TEMPLATE_BULLET_CHANGE = diffFor('packages/x/src/a.ts', [
  ' export const help = `',
  '   Options:',
  '+  * --verbose  say more',
  ' `;',
]);

/** One line added to an existing doc block, where the hunk shows neither the opener nor the code. */
const MID_BLOCK_DOC_CHANGE = diffFor(
  'packages/x/src/a.ts',
  [' * existing line', '+ * added line', ' */', ' export const a = 1;'],
  { newStart: 4, oldStart: 4 },
);

/** The post-image of that file: the opener sits three lines above the hunk. */
const MID_BLOCK_FILE_TEXT = [
  '/**',
  ' * doc',
  ' * more',
  ' * existing line',
  ' * added line',
  ' */',
  'export const a = 1;',
  '',
].join('\n');

const SPEC_TEXT = [
  '# @robota-sdk/agents',
  '',
  '## Architecture Overview',
  '',
  'prose',
  '',
  '## Public API Surface',
  '',
  '- `createAgent`',
  '',
  '## Known Limitations',
  '',
  '- none',
  '',
].join('\n');

const SPEC_TRIGGER_CHANGE = diffFor(
  'packages/agents/docs/SPEC.md',
  [' ## Public API Surface', ' ', '-- `createAgent`', '+- `createAgent`', '+- `runAgent`'],
  { newStart: 7, oldStart: 7 },
);

const SPEC_LIMITATIONS_CHANGE = diffFor(
  'packages/agents/docs/SPEC.md',
  [' ## Known Limitations', ' ', '-- none', '+- one'],
  { newStart: 11, oldStart: 11 },
);

function declared(lane, extra = {}) {
  return {
    lane,
    source: 'PR body',
    fastTrack: null,
    fastTrackSource: null,
    conflicts: [],
    ...extra,
  };
}

function decide(overrides) {
  return decideLane({
    floors: FLOORS,
    specTriggerSections: TRIGGERS,
    readFile: (p) => (p === 'packages/agents/docs/SPEC.md' ? SPEC_TEXT : null),
    ...overrides,
  });
}

describe('scan-lane-declaration — criteria derivation from the rule', () => {
  it('parses every floor row into a pattern, its floor and its qualifier', () => {
    expect(FLOORS.map(({ floor, pattern, qualifier }) => [floor, pattern, qualifier])).toEqual([
      ['L2', 'packages/*/docs/SPEC.md', 'trigger-sections'],
      ['L2', '.github/workflows/**', null],
      ['L2', '.claude/hooks/**', null],
      ['L2', '.agents/rules/**', null],
      ['L2', '.agents/specs/gate-catalogue.md', null],
      ['L1', 'scripts/**', 'non-comment'],
      ['L1', '**/src/**', 'non-comment'],
      ['L0', '**', null],
    ]);
  });

  it('parses the SPEC-update table into the trigger section names, splitting multi-name cells', () => {
    expect(TRIGGERS).toEqual([
      'Public API Surface',
      'Type Ownership',
      'Class Contract Registry',
      'Error Taxonomy',
      'State Lifecycle',
      'Event Architecture',
      'Architecture Overview',
      'relevant section',
      'Extension Points',
    ]);
  });

  it('returns no floors — never a guess — when the section is absent', () => {
    expect(parseLaneFloors(`# rule\n\n${LIVE_SPEC_POLICY}`)).toEqual([]);
    expect(parseLaneFloors('')).toEqual([]);
  });

  it('reads only the table under the floors heading', () => {
    const text = `## Decoy\n\n| L2 | \`**\` | decoy |\n\n#### ${FLOORS_HEADING}\n\n| Floor | Path pattern | Why |\n| --- | --- | --- |\n| L1 | \`**/src/**\` | real |\n\n### Later\n\n| L2 | \`**\` | decoy |\n`;
    expect(parseLaneFloors(text).map((r) => r.pattern)).toEqual(['**/src/**']);
  });

  it('refuses a qualifier it does not implement rather than ignoring it', () => {
    const text = `#### ${FLOORS_HEADING}\n\n| Floor | Path pattern | Why |\n| --- | --- | --- |\n| L2 | \`docs/**#prose-only\` | ? |\n`;
    expect(() => parseLaneFloors(text)).toThrow(/#prose-only/);
  });

  it('translates the table globs the way a path matcher must', () => {
    expect(globToRegExp('**/src/**').test('packages/agents/src/index.ts')).toBe(true);
    expect(globToRegExp('**/src/**').test('src/index.ts')).toBe(true);
    expect(globToRegExp('**/src/**').test('packages/agents/docs/SPEC.md')).toBe(false);
    expect(globToRegExp('packages/*/docs/SPEC.md').test('packages/agents/docs/SPEC.md')).toBe(true);
    expect(globToRegExp('packages/*/docs/SPEC.md').test('packages/a/b/docs/SPEC.md')).toBe(false);
    expect(globToRegExp('.github/workflows/**').test('.github/workflows/ci.yml')).toBe(true);
  });
});

describe('scan-lane-declaration — the live rule parses', () => {
  const liveText = readFileSync(RULE_FILE, 'utf8');

  it('derives the floors from spec-workflow.md as written, qualifiers included', () => {
    const live = parseLaneFloors(liveText);
    expect(live.length).toBeGreaterThanOrEqual(3);
    expect(live).toContainEqual(
      expect.objectContaining({
        floor: 'L2',
        pattern: 'packages/*/docs/SPEC.md',
        qualifier: 'trigger-sections',
      }),
    );
    expect(live).toContainEqual(
      expect.objectContaining({ floor: 'L1', pattern: '**/src/**', qualifier: 'non-comment' }),
    );
    // The Why cell says "a comment-only change is L0"; only the qualifier makes the scan agree.
    expect(live).toContainEqual(
      expect.objectContaining({ floor: 'L1', pattern: 'scripts/**', qualifier: 'non-comment' }),
    );
    expect(live.some((r) => r.floor === 'L2' && r.pattern === '.github/workflows/**')).toBe(true);
  });

  it('anchors a bare filename row at the repository root', () => {
    const bare = parseLaneFloors(liveText).find((r) => r.pattern === 'package.json');
    expect(bare).toBeDefined();
    expect(globToRegExp(bare.pattern).test('package.json')).toBe(true);
    expect(globToRegExp(bare.pattern).test('packages/agents/package.json')).toBe(false);
  });

  it('derives the trigger sections from the SPEC-update table as written', () => {
    const live = parseSpecTriggerSections(liveText);
    expect(live).toEqual(expect.arrayContaining(['Public API Surface', 'Error Taxonomy']));
    expect(live.length).toBeGreaterThanOrEqual(7);
  });
});

describe('scan-lane-declaration — diff reading', () => {
  it('tells a comment-only hunk from a code hunk', () => {
    const [codeHunk] = parseUnifiedDiff(CODE_CHANGE).get('packages/agents/src/index.ts').hunks;
    const [commentHunk] = parseUnifiedDiff(COMMENT_ONLY_CHANGE).get(
      'packages/agents/src/index.ts',
    ).hunks;
    expect(hunkHasCodeChange(codeHunk)).toBe(true);
    expect(hunkHasCodeChange(commentHunk)).toBe(false);
  });

  it('counts a `* ` line as CODE when no block comment encloses it (a bullet in a template literal)', () => {
    const [hunk] = parseUnifiedDiff(TEMPLATE_BULLET_CHANGE).get('packages/x/src/a.ts').hunks;
    expect(hunkHasCodeChange(hunk), 'a string literal was read as a comment').toBe(true);
  });

  it('still reads a `/** … * … */` block the hunk itself opens as comment-only (control)', () => {
    const [hunk] = parseUnifiedDiff(COMMENT_ONLY_CHANGE).get('packages/agents/src/index.ts').hunks;
    expect(hunkHasCodeChange(hunk)).toBe(false);
  });

  it('reads a `* ` line the hunk cannot place as code, unless the post-image places it in a block', () => {
    // Upward is the safe direction: with no opener in sight the line counts as code. The caller
    // that HAS the post-image can say where the hunk starts, and then the same line is a comment.
    const [hunk] = parseUnifiedDiff(MID_BLOCK_DOC_CHANGE).get('packages/x/src/a.ts').hunks;
    expect(hunkHasCodeChange(hunk)).toBe(true);
    expect(hunkHasCodeChange(hunk, { inBlockAtStart: true })).toBe(false);
  });

  it('places a SPEC hunk under the heading in effect in the post-image', () => {
    const file = parseUnifiedDiff(SPEC_TRIGGER_CHANGE).get('packages/agents/docs/SPEC.md');
    expect(fileTouchesTriggerSection(file, TRIGGERS, SPEC_TEXT)).toEqual({
      touches: true,
      section: '## Public API Surface',
    });
    const other = parseUnifiedDiff(SPEC_LIMITATIONS_CHANGE).get('packages/agents/docs/SPEC.md');
    expect(fileTouchesTriggerSection(other, TRIGGERS, SPEC_TEXT).touches).toBe(false);
  });

  it('counts a removed trigger heading, and an unlocatable section, as a trigger', () => {
    const removed = parseUnifiedDiff(
      diffFor('packages/agents/docs/SPEC.md', ['-## Error Taxonomy', '-', '-- E1']),
    ).get('packages/agents/docs/SPEC.md');
    expect(fileTouchesTriggerSection(removed, TRIGGERS, null).section).toBe('## Error Taxonomy');

    const blind = parseUnifiedDiff(diffFor('packages/agents/docs/SPEC.md', ['+- a line'])).get(
      'packages/agents/docs/SPEC.md',
    );
    expect(fileTouchesTriggerSection(blind, TRIGGERS, null).touches).toBe(true);
  });
});

describe('scan-lane-declaration — declaration sources', () => {
  it('reads the spec frontmatter first, then the trailer, then the PR body', () => {
    const spec = {
      path: '.agents/spec-docs/draft/X.md',
      text: '---\nstatus: draft\nlane: L1\n---\n',
    };
    expect(collectDeclaration({ specDocs: [spec] }).lane).toBe('L1');
    expect(collectDeclaration({ trailersText: 'fix: x\n\nLane: L0\n' }).lane).toBe('L0');
    expect(collectDeclaration({ prBodyText: 'Summary\n\nLane: L2\n' }).lane).toBe('L2');
    expect(collectDeclaration({}).lane).toBeNull();
  });

  it('reports a conflict when a lower-priority source disagrees', () => {
    const spec = { path: '.agents/spec-docs/draft/X.md', text: '---\nlane: L1\n---\n' };
    const result = collectDeclaration({ specDocs: [spec], trailersText: 'Lane: L0\n' });
    expect(result.lane).toBe('L1');
    expect(result.conflicts).toEqual([
      'spec-doc frontmatter .agents/spec-docs/draft/X.md declares L1 but commit trailer declares L0',
    ]);
    expect(collectDeclaration({ specDocs: [spec], trailersText: 'Lane: L1\n' }).conflicts).toEqual(
      [],
    );
  });

  it('reports two commit trailers that disagree as a conflict naming both lanes', () => {
    // Two commits in `base..HEAD`, each carrying its own `Lane:`. Reading the first alone would
    // let the second be whatever it likes — and the second may be the one the change needs.
    const result = collectDeclaration({
      trailersText: 'feat: a\n\nLane: L1\n\nfix: b\n\nLane: L0\n',
    });
    expect(result.conflicts).toEqual([
      'commit trailer #1 declares L1 but commit trailer #2 declares L0',
    ]);
    expect(collectDeclaration({ trailersText: 'Lane: L1\n\nLane: L1\n' }).conflicts).toEqual([]);
  });

  it('reads Fast-track from the same sources', () => {
    expect(
      collectDeclaration({ prBodyText: 'Lane: L0\nFast-track: owner said so\n' }),
    ).toMatchObject({ lane: 'L0', fastTrack: 'owner said so', fastTrackSource: 'PR body' });
  });
});

describe('scan-lane-declaration — the TC-02 decision table', () => {
  it('L0 with a non-comment src change → refused, naming the path and the floor', () => {
    const verdict = decide({
      changedPaths: ['packages/agents/src/index.ts'],
      diffText: CODE_CHANGE,
      declaration: declared('L0'),
    });
    expect(verdict.ok).toBe(false);
    expect(verdict.floor).toBe('L1');
    expect(verdict.refusals.join('\n')).toMatch(/declared L0 is below the floor L1/);
    expect(verdict.refusals.join('\n')).toContain('packages/agents/src/index.ts');
  });

  it('L0 with a comment-only src change → accepted (control)', () => {
    const verdict = decide({
      changedPaths: ['packages/agents/src/index.ts'],
      diffText: COMMENT_ONLY_CHANGE,
      declaration: declared('L0'),
    });
    expect(verdict).toMatchObject({ ok: true, floor: 'L0', refusals: [] });
  });

  it('L0 with a `* ` bullet added inside a template literal under src → refused', () => {
    const verdict = decide({
      changedPaths: ['packages/x/src/a.ts'],
      diffText: TEMPLATE_BULLET_CHANGE,
      declaration: declared('L0'),
    });
    expect(verdict.ok, 'a shipped string was waved through as a comment').toBe(false);
    expect(verdict.floor).toBe('L1');
    expect(verdict.refusals[0]).toContain('packages/x/src/a.ts');
  });

  it('L0 adding a line to an existing doc block, placed by the post-image → accepted (control)', () => {
    const verdict = decide({
      changedPaths: ['packages/x/src/a.ts'],
      diffText: MID_BLOCK_DOC_CHANGE,
      declaration: declared('L0'),
      readFile: (p) => (p === 'packages/x/src/a.ts' ? MID_BLOCK_FILE_TEXT : null),
    });
    expect(verdict.ok, verdict.refusals.join('; ')).toBe(true);
    expect(verdict.floor).toBe('L0');
  });

  it('L0 with a non-comment change under scripts/ → refused at L1 (the `scripts/**` row)', () => {
    const verdict = decide({
      changedPaths: ['scripts/harness/x.mjs'],
      diffText: diffFor('scripts/harness/x.mjs', ['-export const b = 2;', '+export const b = 3;']),
      declaration: declared('L0'),
    });
    expect(verdict.ok).toBe(false);
    expect(verdict.floor).toBe('L1');
    expect(verdict.refusals.join('\n')).toContain('scripts/harness/x.mjs');
  });

  it('L0 with a comment-only change under scripts/ → accepted at L0 (control for the row above)', () => {
    const verdict = decide({
      changedPaths: ['scripts/harness/x.mjs'],
      diffText: diffFor('scripts/harness/x.mjs', ['-// old note', '+// new note']),
      declaration: declared('L0'),
    });
    expect(verdict, verdict.refusals.join('; ')).toMatchObject({ ok: true, floor: 'L0' });
  });

  it('L0 with a src path the diff carries no hunk for → refused (cannot prove comment-only)', () => {
    const verdict = decide({
      changedPaths: ['packages/agents/src/index.ts'],
      diffText: '',
      declaration: declared('L0'),
    });
    expect(verdict.ok).toBe(false);
    expect(verdict.refusals.join('\n')).toContain('no hunk in the diff');
  });

  it('L1 with a SPEC trigger-section hunk → refused', () => {
    const verdict = decide({
      changedPaths: ['packages/agents/docs/SPEC.md'],
      diffText: SPEC_TRIGGER_CHANGE,
      declaration: declared('L1'),
    });
    expect(verdict.ok).toBe(false);
    expect(verdict.floor).toBe('L2');
    expect(verdict.refusals.join('\n')).toContain('## Public API Surface');
  });

  it('L1 with a SPEC hunk outside every trigger section → accepted (control)', () => {
    const verdict = decide({
      changedPaths: ['packages/agents/docs/SPEC.md'],
      diffText: SPEC_LIMITATIONS_CHANGE,
      declaration: declared('L1'),
    });
    expect(verdict).toMatchObject({ ok: true, floor: 'L0' });
  });

  it('L1 with a .github/workflows change → refused', () => {
    const verdict = decide({
      changedPaths: ['.github/workflows/ci.yml'],
      diffText: diffFor('.github/workflows/ci.yml', ['+    - run: true']),
      declaration: declared('L1'),
    });
    expect(verdict.ok).toBe(false);
    expect(verdict.refusals.join('\n')).toContain('.github/workflows/ci.yml');
  });

  it('L1 with a .claude/hooks change → refused', () => {
    const verdict = decide({
      changedPaths: ['.claude/hooks/merge-gate.sh'],
      diffText: diffFor('.claude/hooks/merge-gate.sh', ['+exit 0']),
      declaration: declared('L1'),
    });
    expect(verdict.ok).toBe(false);
    expect(verdict.refusals.join('\n')).toContain('.claude/hooks/merge-gate.sh');
  });

  it('L1 with a gate-rule document change → refused', () => {
    const verdict = decide({
      changedPaths: ['.agents/rules/spec-workflow.md'],
      diffText: diffFor('.agents/rules/spec-workflow.md', ['+A new rule.']),
      declaration: declared('L1'),
    });
    expect(verdict.ok).toBe(false);
    expect(verdict.floor).toBe('L2');
  });

  it('L2 on anything → accepted', () => {
    const verdict = decide({
      changedPaths: [
        'packages/agents/src/index.ts',
        'packages/agents/docs/SPEC.md',
        '.github/workflows/ci.yml',
        '.claude/hooks/merge-gate.sh',
        '.agents/rules/spec-workflow.md',
      ],
      diffText: CODE_CHANGE + SPEC_TRIGGER_CHANGE,
      declaration: declared('L2'),
    });
    expect(verdict).toMatchObject({ ok: true, floor: 'L2', refusals: [] });
  });

  it('L1 declared on an L0-eligible diff → accepted (upward is never refused)', () => {
    const verdict = decide({
      changedPaths: ['README.md'],
      diffText: diffFor('README.md', ['+a line']),
      declaration: declared('L1'),
    });
    expect(verdict).toMatchObject({ ok: true, floor: 'L0' });
  });

  it('missing Lane → refused', () => {
    const verdict = decide({
      changedPaths: ['README.md'],
      diffText: diffFor('README.md', ['+a line']),
      declaration: declared(null),
    });
    expect(verdict.ok).toBe(false);
    expect(verdict.refusals.join('\n')).toMatch(/no lane declared/);
  });

  it('Fast-track on an L2 path → refused even at L2', () => {
    const verdict = decide({
      changedPaths: ['.github/workflows/ci.yml'],
      diffText: diffFor('.github/workflows/ci.yml', ['+    - run: true']),
      declaration: declared('L2', { fastTrack: 'owner asked', fastTrackSource: 'PR body' }),
    });
    expect(verdict.ok).toBe(false);
    expect(verdict.refusals.join('\n')).toMatch(
      /Fast-track: "owner asked" .* not available on an L2 path/,
    );
  });

  it('Fast-track on an L0 path → accepted (control)', () => {
    const verdict = decide({
      changedPaths: ['README.md'],
      diffText: diffFor('README.md', ['+a line']),
      declaration: declared('L0', { fastTrack: 'owner asked', fastTrackSource: 'PR body' }),
    });
    expect(verdict.ok).toBe(true);
  });

  it('conflicting declarations → refused', () => {
    const verdict = decide({
      changedPaths: ['README.md'],
      diffText: diffFor('README.md', ['+a line']),
      declaration: declared('L1', { conflicts: ['spec says L1 but commit trailer says L0'] }),
    });
    expect(verdict.ok).toBe(false);
    expect(verdict.refusals[0]).toContain('conflicting declarations');
  });

  it('reports the size of what it walked, reset per run', () => {
    findLaneFloors({
      changedPaths: ['README.md', 'docs/a.md', 'packages/agents/src/index.ts'],
      diffText: CODE_CHANGE,
      floors: FLOORS,
      specTriggerSections: TRIGGERS,
    });
    expect(readExamined()).toBe(3);
    findLaneFloors({ changedPaths: ['README.md'], floors: FLOORS, specTriggerSections: TRIGGERS });
    expect(readExamined()).toBe(1);
  });

  it('throws — never passes — when handed no floors', () => {
    expect(() =>
      decideLane({ changedPaths: ['README.md'], declaration: declared('L2'), floors: [] }),
    ).toThrow(new RegExp(FLOORS_HEADING));
  });

  it('throws when a #trigger-sections row has no SPEC-update table to read', () => {
    expect(() =>
      decideLane({
        changedPaths: ['packages/agents/docs/SPEC.md'],
        diffText: SPEC_TRIGGER_CHANGE,
        declaration: declared('L2'),
        floors: FLOORS,
        specTriggerSections: [],
      }),
    ).toThrow(/Live Spec Policy/);
  });
});

// ── CLI contract ─────────────────────────────────────────────────────────────────────────────────

function makeRoot({ ruleText = RULE_TEXT, files = {} } = {}) {
  const root = makeTemp('robota-lane-');
  mkdirSync(path.join(root, '.agents/rules'), { recursive: true });
  writeFileSync(path.join(root, '.agents/rules/spec-workflow.md'), ruleText);
  for (const [relative, text] of Object.entries(files)) {
    mkdirSync(path.join(root, path.dirname(relative)), { recursive: true });
    writeFileSync(path.join(root, relative), text);
  }
  return root;
}

function runScan(root, args) {
  return spawnSync('node', [SCAN_SCRIPT, '--root', root, ...args], {
    encoding: 'utf8',
    env: { ...process.env, HARNESS_PR_BODY_FILE: '' },
  });
}

describe('scan-lane-declaration — exit contract', () => {
  it('exits 1 naming the path and the floor when the declared lane is below it', () => {
    const root = makeRoot({ files: { 'diff.patch': CODE_CHANGE, 'body.txt': 'Lane: L0\n' } });
    const run = runScan(root, [
      '--diff-file',
      path.join(root, 'diff.patch'),
      '--pr-body-file',
      path.join(root, 'body.txt'),
    ]);
    expect(run.status).toBe(1);
    expect(run.stdout).toContain('::examined:: 1 changed path(s)');
    expect(run.stderr).toContain('declared L0 is below the floor L1');
    expect(run.stderr).toContain('packages/agents/src/index.ts');
    expect(run.stderr).toContain('result=FAIL');
  });

  it('exits 0 when the declaration meets the floor (control)', () => {
    const root = makeRoot({ files: { 'diff.patch': CODE_CHANGE, 'body.txt': 'Lane: L1\n' } });
    const run = runScan(root, [
      '--changed',
      'packages/agents/src/index.ts',
      '--diff-file',
      path.join(root, 'diff.patch'),
      '--pr-body-file',
      path.join(root, 'body.txt'),
    ]);
    expect(run.status, run.stderr).toBe(0);
    expect(run.stdout).toContain('violations=0 result=PASS');
  });

  it('reads the lane from a changed spec document, and refuses when the trailer disagrees', () => {
    const spec = '.agents/spec-docs/draft/PROC-999-x.md';
    const root = makeRoot({
      files: {
        [spec]: '---\nstatus: draft\nlane: L1\n---\n\n# x\n',
        'trailers.txt': 'docs: x\n\nLane: L1\n',
        'conflict.txt': 'docs: x\n\nLane: L0\n',
      },
    });
    const agree = runScan(root, [
      '--changed',
      spec,
      '--trailers-file',
      path.join(root, 'trailers.txt'),
    ]);
    expect(agree.status, agree.stderr).toBe(0);
    expect(agree.stdout).toContain('L1 (spec-doc frontmatter');

    const conflict = runScan(root, [
      '--changed',
      spec,
      '--trailers-file',
      path.join(root, 'conflict.txt'),
    ]);
    expect(conflict.status).toBe(1);
    expect(conflict.stderr).toContain('conflicting declarations');
  });

  it('refuses two commit trailers that disagree, naming both lanes; accepts two that agree', () => {
    const root = makeRoot({
      files: {
        'disagree.txt': 'feat: a\n\nLane: L1\n\nfix: b\n\nLane: L0\n',
        'agree.txt': 'feat: a\n\nLane: L1\n\nfix: b\n\nLane: L1\n',
      },
    });
    const disagree = runScan(root, [
      '--changed',
      'README.md',
      '--trailers-file',
      path.join(root, 'disagree.txt'),
    ]);
    expect(disagree.status, 'the second trailer was never read').toBe(1);
    expect(disagree.stderr).toContain('conflicting declarations');
    expect(disagree.stderr).toMatch(/declares L1 .*declares L0/);

    const agree = runScan(root, [
      '--changed',
      'README.md',
      '--trailers-file',
      path.join(root, 'agree.txt'),
    ]);
    expect(agree.status, agree.stderr).toBe(0);
  });

  it('exits 1 on a missing declaration', () => {
    const root = makeRoot();
    const run = runScan(root, ['--changed', 'README.md']);
    expect(run.status).toBe(1);
    expect(run.stderr).toContain('no lane declared');
  });

  it('exits 1 on Fast-track over an L2 path', () => {
    const root = makeRoot({ files: { 'body.txt': 'Lane: L2\nFast-track: owner asked\n' } });
    const run = runScan(root, [
      '--changed',
      '.claude/hooks/merge-gate.sh',
      '--pr-body-file',
      path.join(root, 'body.txt'),
    ]);
    expect(run.status).toBe(1);
    expect(run.stderr).toContain('Fast-track');
  });

  it('FAILS CLOSED when the floors table is absent, naming the section', () => {
    const root = makeRoot({
      ruleText: `# rule\n\n${LIVE_SPEC_POLICY}`,
      files: { 'body.txt': 'Lane: L2\n' },
    });
    const run = runScan(root, [
      '--changed',
      'README.md',
      '--pr-body-file',
      path.join(root, 'body.txt'),
    ]);
    expect(run.status).toBe(1);
    expect(run.stderr).toContain(`#### ${FLOORS_HEADING}`);
  });

  it('FAILS CLOSED when the rule file is absent', () => {
    const root = makeTemp('robota-lane-ruleless-');
    const run = runScan(root, ['--changed', 'README.md']);
    expect(run.status).toBe(1);
    expect(run.stderr).toContain('.agents/rules/spec-workflow.md missing');
  });

  it('reads the changed set, diff and trailer from git when no fixture flags are given', () => {
    const root = makeRoot();
    const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' });
    git('init', '-q', '-b', 'develop');
    git('config', 'user.email', 'probe@example.invalid');
    git('config', 'user.name', 'probe');
    git('config', 'commit.gpgsign', 'false');
    mkdirSync(path.join(root, 'packages/agents/src'), { recursive: true });
    writeFileSync(path.join(root, 'packages/agents/src/index.ts'), 'export const a = 1;\n');
    git('add', '-A');
    git('commit', '-q', '-m', 'base');
    git('checkout', '-q', '-b', 'feat/x');
    writeFileSync(path.join(root, 'packages/agents/src/index.ts'), 'export const a = 2;\n');
    git('commit', '-q', '-am', 'feat: bump\n\nLane: L0');
    const refused = runScan(root, ['--base', 'develop']);
    expect(refused.status).toBe(1);
    expect(refused.stdout).toContain('::examined:: 1 changed path(s)');
    expect(refused.stderr).toContain('declared L0 is below the floor L1');

    // A later commit that re-declares the lane is a CONFLICT, not a re-declaration: every trailer
    // in `base..HEAD` is read, and two that disagree are refused naming both. The first version
    // took the first trailer `git log` listed and let the other say anything.
    git('commit', '-q', '--allow-empty', '-m', 'chore: relane\n\nLane: L1');
    const conflicted = runScan(root, ['--base', 'develop']);
    expect(conflicted.status, 'the second trailer was never read').toBe(1);
    expect(conflicted.stderr).toContain('conflicting declarations');
    expect(conflicted.stderr).toMatch(/declares L1 .*declares L0/);

    // Raising the lane means the record says one thing: reword the commit that declared it.
    git('reset', '-q', '--hard', 'HEAD~1');
    git('commit', '-q', '--amend', '-m', 'feat: bump\n\nLane: L1');
    const raised = runScan(root, ['--base', 'develop']);
    expect(raised.status, raised.stderr).toBe(0);
    expect(raised.stdout).toContain('L1 (commit trailer)');

    git('checkout', '-q', 'develop');
    const nothing = runScan(root, ['--base', 'develop']);
    expect(nothing.status, nothing.stderr).toBe(0);
    expect(nothing.stdout).toContain('::examined:: 0 changed path(s) ::expected-empty::');
  });
});

describe('scan-lane-declaration — importing it does nothing', () => {
  it('prints nothing and exits 0 when imported', () => {
    const run = spawnSync(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        `await import(${JSON.stringify(pathToFileURL(SCAN_SCRIPT).href)});`,
      ],
      { encoding: 'utf8' },
    );
    expect(run.status).toBe(0);
    expect(`${run.stdout}${run.stderr}`.trim()).toBe('');
  });
});

describe('a line that starts with a block-comment marker is code when a statement follows it (PR #2419 review)', () => {
  it('`/* a */ code();` and `*​/ code();` are code lines', () => {
    expect(isCommentOrBlankLine('/* a */ code();')).toBe(false);
    expect(isCommentOrBlankLine('*/ code();', true)).toBe(false);
    expect(isCommentOrBlankLine('/* a */ /* b */ return 1;')).toBe(false);
  });

  it('a line whose comment segments cover it entirely is still a comment line', () => {
    expect(isCommentOrBlankLine('/* a */')).toBe(true);
    expect(isCommentOrBlankLine('/* a */ // note')).toBe(true);
    expect(isCommentOrBlankLine('/* a */ /* b */')).toBe(true);
    expect(isCommentOrBlankLine('/* opens and runs on')).toBe(true);
    expect(isCommentOrBlankLine('*/', true)).toBe(true);
    expect(isCommentOrBlankLine('* inside', true)).toBe(true);
  });
});
