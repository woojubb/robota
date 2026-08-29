import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { makeTemp } from './make-temp.mjs';

import {
  parseIssueFormLabels,
  readExaminedGithubLabelRegistryCount,
  scanGithubLabelRegistry,
  validateRegistry,
} from '../scan-github-label-registry.mjs';

const CORE = [
  ['bug', 'work-kind'],
  ['enhancement', 'work-kind'],
  ['documentation', 'work-kind'],
  ['status:needs-triage', 'intake'],
  ['priority:P0', 'priority'],
  ['priority:P1', 'priority'],
  ['priority:P2', 'priority'],
];

const PROTECTED = [
  [
    'disposition-containment',
    [
      '.github/workflows/review-gate.yml',
      '.claude/hooks/merge-gate.sh',
      'scripts/harness/record-local-review.mjs',
    ],
  ],
  [
    'disposition-re-plan',
    [
      '.github/workflows/review-gate.yml',
      '.claude/hooks/merge-gate.sh',
      'scripts/harness/record-local-review.mjs',
    ],
  ],
  ['review-findings-acknowledged', ['scripts/harness/check-review-gate.mjs']],
];

function label(name, category) {
  return {
    name,
    color: '123abc',
    description: `${name} description`,
    category,
    appliesTo: ['issue'],
    lifecycle: 'core',
    producers: ['fixture'],
    consumers: ['fixture'],
  };
}

function registry(labels = CORE.map(([name, category]) => label(name, category))) {
  return {
    version: 1,
    core: {
      workKinds: ['bug', 'enhancement', 'documentation'],
      intake: 'status:needs-triage',
      priorities: ['priority:P0', 'priority:P1', 'priority:P2'],
    },
    labels,
  };
}

function systemLabel(name, consumers) {
  return {
    ...label(name, 'pr-protocol'),
    appliesTo: ['pull_request'],
    lifecycle: 'system',
    protected: true,
    consumers,
  };
}

function fullRegistry() {
  return registry([
    ...CORE.map(([name, category]) => label(name, category)),
    ...PROTECTED.map(([name, consumers]) => systemLabel(name, consumers)),
  ]);
}

function issueForm(kind) {
  return `name: Fixture\ndescription: Fixture form\nlabels: ["${kind}", "status:needs-triage"]\nbody:\n  - type: textarea\n    id: observed\n    validations:\n      required: true\n  - type: textarea\n    id: expected\n    validations:\n      required: true\n  - type: textarea\n    id: context\n    validations:\n      required: true\n`;
}

describe('GitHub label registry core', () => {
  it('parses formatter-normalized YAML single-quoted label arrays', () => {
    expect(parseIssueFormLabels("labels: ['bug', 'status:needs-triage']\n", 'fixture.yml')).toEqual(
      ['bug', 'status:needs-triage'],
    );
  });

  it('accepts exactly seven core labels and rejects a duplicate exact name', () => {
    expect(validateRegistry(fullRegistry())).toEqual([]);

    const duplicate = registry([
      ...CORE.map(([name, category]) => label(name, category)),
      label('bug', 'work-kind'),
    ]);
    expect(validateRegistry(duplicate)).toContain('duplicate label name `bug`');
  });

  it('checks Issue Form labels and a fixed protected-consumer baseline', () => {
    const root = makeTemp('github-label-registry-');
    mkdirSync(path.join(root, '.github/ISSUE_TEMPLATE'), { recursive: true });
    mkdirSync(path.join(root, '.claude/hooks'), { recursive: true });
    mkdirSync(path.join(root, 'scripts/harness'), { recursive: true });
    writeFileSync(path.join(root, '.github/labels.json'), JSON.stringify(fullRegistry()));
    writeFileSync(path.join(root, '.github/ISSUE_TEMPLATE/bug_report.yml'), issueForm('bug'));
    writeFileSync(
      path.join(root, '.github/ISSUE_TEMPLATE/feature_request.yml'),
      issueForm('enhancement'),
    );
    writeFileSync(
      path.join(root, '.github/ISSUE_TEMPLATE/documentation.yml'),
      issueForm('documentation'),
    );
    for (const [name, consumers] of PROTECTED) {
      for (const consumer of consumers) {
        const file = path.join(root, consumer);
        mkdirSync(path.dirname(file), { recursive: true });
        const existing = existsSync(file) ? readFileSync(file, 'utf8') : '';
        writeFileSync(file, `${existing}${name}\n`);
      }
    }

    const passing = scanGithubLabelRegistry(root);
    expect(passing.findings).toEqual([]);
    expect(readExaminedGithubLabelRegistryCount(root)).toBe(20);
    scanGithubLabelRegistry(root);
    expect(readExaminedGithubLabelRegistryCount(root)).toBe(20);

    writeFileSync(path.join(root, '.claude/hooks/merge-gate.sh'), 'disposition-containment\n');
    writeFileSync(
      path.join(root, '.github/ISSUE_TEMPLATE/bug_report.yml'),
      issueForm('undeclared-kind'),
    );
    const failing = scanGithubLabelRegistry(root);
    expect(failing.findings).toContain(
      'protected label `disposition-re-plan` is absent from `.claude/hooks/merge-gate.sh`',
    );
    expect(failing.findings).toContain(
      'Issue Form `.github/ISSUE_TEMPLATE/bug_report.yml` references undeclared label `undeclared-kind`',
    );
  });
});
