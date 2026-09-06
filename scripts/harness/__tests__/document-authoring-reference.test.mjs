/** INFRA-143 — new governed documents reject reference-kind omissions before they are completed. */

import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { recordStub } from '../allocate-work-item-id.mjs';
import {
  documentAuthoringReferenceError,
  findDocumentAuthoringReferenceFindings,
} from '../document-authoring-reference.mjs';
import { main as newSpecMain } from '../new-spec.mjs';
import { makeTemp } from './make-temp.mjs';

const WORKSPACE_ROOT = path.resolve(import.meta.dirname, '../../..');

function taskRoot(objective) {
  const root = makeTemp('robota-authoring-reference-');
  mkdirSync(path.join(root, '.agents/tasks'), { recursive: true });
  mkdirSync(path.join(root, '.agents/spec-docs/draft'), { recursive: true });
  mkdirSync(path.join(root, '.agents/templates'), { recursive: true });
  writeFileSync(
    path.join(root, '.agents/templates/mini-spec-template.md'),
    readFileSync(path.join(WORKSPACE_ROOT, '.agents/templates/mini-spec-template.md'), 'utf8'),
  );
  writeFileSync(
    path.join(root, '.agents/tasks/INFRA-2510-reference-kinds.md'),
    recordStub({
      id: 'INFRA-2510',
      title: 'reference kinds are enforced before authoring completes',
      today: '2026-09-06',
      issue: 2510,
    }).replace('TODO\n\n## Plan', `${objective}\n\n## Plan`),
  );
  return root;
}

describe('the shared authoring judgement', () => {
  it('reports path, line, reference, and accepted qualified forms', () => {
    const error = documentAuthoringReferenceError({
      file: '.agents/tasks/INFRA-2510-reference-kinds.md',
      text: 'Objective\nsee #1916',
    });
    expect(error).toContain('.agents/tasks/INFRA-2510-reference-kinds.md:2');
    expect(error).toContain('#1916');
    expect(error).toContain('issue #N');
    expect(error).toContain('PR #N');
  });

  it('accepts qualified, closing-keyword, and specimen references', () => {
    expect(
      findDocumentAuthoringReferenceFindings({
        file: 'new.md',
        text: 'issue #1916\nPR #1917\nCloses #1918\n`#1919`',
      }),
    ).toEqual([]);
  });
});

describe('new-spec uses the boundary before dry-run or write completion', () => {
  it('rejects a bare reference copied from a Task Objective', () => {
    const root = taskRoot('The regression is tracked by #1916.');
    let stdout = '';
    let stderr = '';
    const code = newSpecMain(
      [
        'INFRA-2510',
        '--type',
        'INFRA',
        '--issue',
        '2510',
        '--lane',
        'L1',
        '--legacy-id',
        '--dry-run',
        '--root',
        root,
      ],
      {
        stdout: { write: (value) => (stdout += value) },
        stderr: { write: (value) => (stderr += value) },
      },
    );
    expect(code).toBe(1);
    expect(stdout).toBe('');
    expect(stderr).toContain('document authoring refused');
    expect(stderr).toContain('INFRA-2510-reference-kinds.md');
    expect(stderr).toContain('#1916');
  });

  it('keeps the generated spec path clean when the Task is qualified', () => {
    const root = taskRoot('The regression is tracked by issue #1916.');
    const result = spawnSync(
      process.execPath,
      [
        path.join(WORKSPACE_ROOT, 'scripts/harness/new-spec.mjs'),
        'INFRA-2510',
        '--type',
        'INFRA',
        '--issue',
        '2510',
        '--lane',
        'L1',
        '--legacy-id',
        '--dry-run',
        '--root',
        root,
      ],
      { encoding: 'utf8' },
    );
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('issue #1916');
  });
});

describe('the Task allocator shares the same boundary', () => {
  it('wires the shared judgement before its wx write', () => {
    const source = readFileSync(
      path.join(WORKSPACE_ROOT, 'scripts/harness/allocate-work-item-id.mjs'),
      'utf8',
    );
    expect(source).toContain("from './document-authoring-reference.mjs'");
    expect(source).toContain('documentAuthoringReferenceError({ file, text: document })');
    expect(source.indexOf('documentAuthoringReferenceError')).toBeLessThan(
      source.indexOf('writeFileSync(absolute, document'),
    );
  });
});
