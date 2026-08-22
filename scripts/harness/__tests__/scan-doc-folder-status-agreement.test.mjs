import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { makeTemp } from './make-temp.mjs';

import {
  findFolderStatusFindings,
  parseStatusFolderMapping,
} from '../scan-doc-folder-status-agreement.mjs';

const SCAN_SCRIPT = fileURLToPath(
  new URL('../scan-doc-folder-status-agreement.mjs', import.meta.url),
);
const RULE_FILE = fileURLToPath(
  new URL('../../../.agents/rules/spec-workflow.md', import.meta.url),
);

/**
 * The mapping as `spec-workflow.md` § Spec-Document Status and Lifecycle Folders states it. This is
 * NOT a second implementation of the rule — the scan derives its criteria from that table at run
 * time. This is the pin that fails when the table changes without anyone noticing, which is the
 * failure mode a derived-criteria design trades for.
 */
const RULE_MAPPING = {
  draft: 'draft',
  'review-ready': 'backlog',
  approved: 'todo',
  'in-progress': 'active',
  verifying: 'active',
  done: 'done',
  rejected: 'rejected',
};

function spec(status) {
  return `---\nstatus: ${status}\ntype: RULE\ntags: [harness]\n---\n\n# fixture\n`;
}

async function makeTree(files) {
  const root = makeTemp('folder-status-');
  for (const [relative, text] of Object.entries(files)) {
    const full = path.join(root, relative);
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, text);
  }
  return root;
}

describe('scan-doc-folder-status-agreement — criteria derivation', () => {
  it('derives the whole mapping from the rule that owns it, not from a copy in the scan', () => {
    const mapping = parseStatusFolderMapping(readFileSync(RULE_FILE, 'utf8'));
    expect(Object.fromEntries(mapping)).toEqual(RULE_MAPPING);
  });

  it('reads only the table under the mapping heading', () => {
    const text = [
      '## Some Other Section',
      '',
      '| `draft` | `.agents/spec-docs/nowhere/` | decoy |',
      '',
      '### Spec-Document Status and Lifecycle Folders',
      '',
      '| `draft` | `.agents/spec-docs/draft/` | real |',
      '| `done` | `.agents/spec-docs/done/` | real |',
      '',
      '### A Later Section',
      '',
      '| `approved` | `.agents/spec-docs/elsewhere/` | decoy |',
    ].join('\n');
    expect(Object.fromEntries(parseStatusFolderMapping(text))).toEqual({
      draft: 'draft',
      done: 'done',
    });
  });

  it('returns an empty mapping — never a partial guess — when the section is absent', () => {
    expect(parseStatusFolderMapping('# a rule with no mapping table\n').size).toBe(0);
    expect(parseStatusFolderMapping('').size).toBe(0);
  });
});

describe('scan-doc-folder-status-agreement — detection', () => {
  const mapping = new Map(Object.entries(RULE_MAPPING));

  it('reports every shape of the six live violations this floor was built for', async () => {
    const root = await makeTree({
      'done/INFRA-016.md': spec('draft'),
      'done/PM-026.md': spec('approved'),
      'done/DATA-002.md': spec('in-progress'),
    });
    expect(findFolderStatusFindings(root, mapping)).toEqual([
      {
        file: 'done/DATA-002.md',
        status: 'in-progress',
        actualFolder: 'done',
        expectedFolder: 'active',
      },
      { file: 'done/INFRA-016.md', status: 'draft', actualFolder: 'done', expectedFolder: 'draft' },
      { file: 'done/PM-026.md', status: 'approved', actualFolder: 'done', expectedFolder: 'todo' },
    ]);
  });

  it('passes a tree where every document agrees, both statuses that share active/ included', async () => {
    const root = await makeTree({
      'draft/A.md': spec('draft'),
      'backlog/B.md': spec('review-ready'),
      'todo/C.md': spec('approved'),
      'active/D.md': spec('in-progress'),
      'active/E.md': spec('verifying'),
      'done/F.md': spec('done'),
      'rejected/G.md': spec('rejected'),
    });
    expect(findFolderStatusFindings(root, mapping)).toEqual([]);
  });

  it('reports a spec document sitting in no lifecycle folder at all', async () => {
    const root = await makeTree({ 'STRAY.md': spec('done') });
    expect(findFolderStatusFindings(root, mapping)).toEqual([
      { file: 'STRAY.md', status: 'done', actualFolder: null, expectedFolder: 'done' },
    ]);
  });

  it('leaves README.md and frontmatter-validity defects to their own owners', async () => {
    const root = await makeTree({
      'done/README.md': spec('draft'),
      'done/no-frontmatter.md': '# just a heading\n',
      'done/unknown-status.md': spec('shipped'),
    });
    expect(findFolderStatusFindings(root, mapping)).toEqual([]);
  });

  it('reads a status the repo formatter may have wrapped, via the SSOT frontmatter parser', async () => {
    const root = await makeTree({
      'done/wrapped.md':
        '---\nstatus:\n  draft\ntype: RULE\ntags:\n  - harness\n---\n\n# fixture\n',
    });
    expect(findFolderStatusFindings(root, mapping).map((f) => f.status)).toEqual(['draft']);
  });
});

describe('scan-doc-folder-status-agreement — exit contract', () => {
  it('exits 1 and names each offender', async () => {
    const root = await makeTree({ 'done/INFRA-016.md': spec('draft') });
    const run = spawnSync('node', [SCAN_SCRIPT, root], { encoding: 'utf8' });
    expect(run.status).toBe(1);
    expect(run.stderr).toContain('done/INFRA-016.md');
    expect(run.stderr).toContain('expected draft/, found done/');
    expect(run.stderr).toContain('violations=1 result=FAIL');
  });

  it('exits 0 on an agreeing tree', async () => {
    const root = await makeTree({ 'done/F.md': spec('done') });
    const run = spawnSync('node', [SCAN_SCRIPT, root], { encoding: 'utf8' });
    expect(run.status).toBe(0);
    expect(run.stdout).toContain('violations=0 result=PASS');
  });

  it('FAILS CLOSED when it cannot read its own criteria', async () => {
    const root = await makeTree({ 'done/F.md': spec('done'), 'ruleless.md': '# no table\n' });
    const emptyRule = path.join(root, 'ruleless.md');
    const run = spawnSync('node', [SCAN_SCRIPT, root, emptyRule], { encoding: 'utf8' });
    expect(run.status).toBe(1);
    expect(run.stderr).toContain('refuses to pass');

    const missing = spawnSync('node', [SCAN_SCRIPT, root, path.join(root, 'nope.md')], {
      encoding: 'utf8',
    });
    expect(missing.status).toBe(1);
  });
});

describe('the subject cannot be absent and still read as clean', () => {
  it('refuses a spec-docs tree that is not there', async () => {
    // PROC-006 prerequisite, measured 2026-08-01. This finder governs `.agents/spec-docs`, the tree
    // that item is about to move, and it returned 0 findings over a root without one — the same
    // words it uses over 242 documents. `scan-guard-scope-fail-closed` did not catch it: that scan
    // derives its finder set from `export function find…(root`, and this finder's first parameter is
    // the DIRECTORY, so it sits outside the ceiling that scan states in its own header.
    //
    // A rename that leaves this quiet is a rename nothing reports.
    const root = makeTemp('absent-spec-docs-');
    const mapping = parseStatusFolderMapping(
      '## Spec-Document Status and Lifecycle Folders\n\n| status | folder |\n| --- | --- |\n| `todo` | `.agents/spec-docs/todo/` |\n',
    );
    expect(
      () => findFolderStatusFindings(path.join(root, '.agents/spec-docs'), mapping),
      'an absent subject was reported as clean',
    ).toThrow(/spec-docs/);
  });
});
