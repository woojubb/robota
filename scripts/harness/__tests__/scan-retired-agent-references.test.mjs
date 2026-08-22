import { mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  examinedRetiredReferenceFileCount,
  findRetiredAgentReferenceFindings,
  normalizedLineFingerprint,
} from '../scan-retired-agent-references.mjs';
import { makeTemp } from './make-temp.mjs';

const RETIRED_NAME = ['architecture', 'auditor'].join('-');

function workspace() {
  const root = makeTemp('robota-retired-agent-references-');
  for (const rel of [
    '.claude/agents',
    '.agents/rules',
    '.agents/skills',
    '.agents/specs',
    '.agents/memory',
    '.agents/spec-docs/draft',
    '.agents/spec-docs/backlog',
    '.agents/spec-docs/todo',
    '.agents/spec-docs/active',
    '.agents/tasks',
    'scripts/harness',
  ]) {
    mkdirSync(path.join(root, rel), { recursive: true });
  }
  file(root, '.agents/architecture-remediation-log.md', '');
  return root;
}

function file(root, rel, text) {
  const target = path.join(root, rel);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, text, 'utf8');
}

describe('retired broad-agent references', () => {
  it('is registered in the aggregate harness', () => {
    const aggregate = readFileSync(
      path.resolve(import.meta.dirname, '../run-all-scans.mjs'),
      'utf8',
    );
    expect(aggregate).toContain("name: 'retired-agent-references'");
    expect(aggregate).toContain(
      "command: ['node', 'scripts/harness/scan-retired-agent-references.mjs']",
    );
  });

  it('reports the exact number of live files examined and resets between scans', () => {
    const populated = workspace();
    file(populated, '.agents/memory/one.md', 'No retired dispatch here.\n');
    findRetiredAgentReferenceFindings(populated, { mode: 'normal', allowlist: [] });
    expect(examinedRetiredReferenceFileCount()).toBe(2);

    const empty = workspace();
    findRetiredAgentReferenceFindings(empty, { mode: 'normal', allowlist: [] });
    expect(examinedRetiredReferenceFileCount()).toBe(1);
  });

  it('fails actionable memory guidance while ignoring completed Task history', () => {
    const root = workspace();
    file(root, '.agents/memory/live.md', `Run ${RETIRED_NAME} at every midpoint.\n`);
    file(
      root,
      '.agents/tasks/completed/HIST-1.md',
      `The ${RETIRED_NAME} endorsed this completed change.\n`,
    );
    const findings = findRetiredAgentReferenceFindings(root, { mode: 'normal', allowlist: [] });
    expect(findings).toHaveLength(1);
    expect(findings[0].file).toBe('.agents/memory/live.md');
  });

  it('covers executable harness sources and refuses a symlinked governed root', () => {
    const root = workspace();
    file(root, 'scripts/harness/live-check.sh', `# dispatch ${RETIRED_NAME}\n`);
    expect(findRetiredAgentReferenceFindings(root, { mode: 'normal', allowlist: [] })).toEqual([
      expect.objectContaining({ file: 'scripts/harness/live-check.sh' }),
    ]);

    const external = path.join(root, 'external-memory');
    mkdirSync(external, { recursive: true });
    rmSync(path.join(root, '.agents/memory'), { recursive: true });
    symlinkSync(external, path.join(root, '.agents/memory'), 'dir');
    expect(() =>
      findRetiredAgentReferenceFindings(root, { mode: 'normal', allowlist: [] }),
    ).toThrow(/governed path.*symlink/);

    const taskRoot = workspace();
    const externalTasks = path.join(taskRoot, 'external-tasks');
    mkdirSync(externalTasks, { recursive: true });
    rmSync(path.join(taskRoot, '.agents/tasks'), { recursive: true });
    symlinkSync(externalTasks, path.join(taskRoot, '.agents/tasks'), 'dir');
    expect(() =>
      findRetiredAgentReferenceFindings(taskRoot, { mode: 'normal', allowlist: [] }),
    ).toThrow(/governed path.*tasks.*symlink/);

    const singleFileRoot = workspace();
    const externalLog = path.join(singleFileRoot, 'external-log.md');
    writeFileSync(externalLog, '', 'utf8');
    rmSync(path.join(singleFileRoot, '.agents/architecture-remediation-log.md'));
    symlinkSync(externalLog, path.join(singleFileRoot, '.agents/architecture-remediation-log.md'));
    expect(() =>
      findRetiredAgentReferenceFindings(singleFileRoot, { mode: 'normal', allowlist: [] }),
    ).toThrow(/governed path.*architecture-remediation-log.*symlink/);

    const nestedFileRoot = workspace();
    const externalFile = path.join(nestedFileRoot, 'external-memory.md');
    writeFileSync(externalFile, `Dispatch ${RETIRED_NAME}.\n`, 'utf8');
    symlinkSync(externalFile, path.join(nestedFileRoot, '.agents/memory/live.md'));
    expect(() =>
      findRetiredAgentReferenceFindings(nestedFileRoot, { mode: 'normal', allowlist: [] }),
    ).toThrow(/governed path.*memory\/live\.md.*symlink/);

    const nestedDirectoryRoot = workspace();
    const externalDirectory = path.join(nestedDirectoryRoot, 'external-memory');
    mkdirSync(externalDirectory, { recursive: true });
    symlinkSync(externalDirectory, path.join(nestedDirectoryRoot, '.agents/memory/nested'), 'dir');
    expect(() =>
      findRetiredAgentReferenceFindings(nestedDirectoryRoot, { mode: 'normal', allowlist: [] }),
    ).toThrow(/governed path.*memory\/nested.*symlink/);

    const taskFileRoot = workspace();
    const externalTask = path.join(taskFileRoot, 'OPEN-1.md');
    writeFileSync(externalTask, `Dispatch ${RETIRED_NAME}.\n`, 'utf8');
    symlinkSync(externalTask, path.join(taskFileRoot, '.agents/tasks/OPEN-1.md'));
    expect(() =>
      findRetiredAgentReferenceFindings(taskFileRoot, { mode: 'normal', allowlist: [] }),
    ).toThrow(/governed path.*tasks\/OPEN-1\.md.*symlink/);
  });

  it('permits only the retiring definition before deletion and rejects it afterward', () => {
    const root = workspace();
    file(root, `.claude/agents/${RETIRED_NAME}.md`, `name: ${RETIRED_NAME}\n`);

    expect(findRetiredAgentReferenceFindings(root, { mode: 'pre-delete', allowlist: [] })).toEqual(
      [],
    );
    expect(findRetiredAgentReferenceFindings(root, { mode: 'normal', allowlist: [] })).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ file: `.claude/agents/${RETIRED_NAME}.md` }),
      ]),
    );
  });

  it('accepts only exact documented provenance and rejects stale fingerprints', () => {
    const root = workspace();
    const line = `Historical verdict: ${RETIRED_NAME} endorsed the proposal.`;
    file(root, '.agents/memory/history.md', `${line}\n`);
    const entry = {
      file: '.agents/memory/history.md',
      fingerprint: normalizedLineFingerprint(line),
      reason: 'dated endorsement provenance',
    };

    expect(findRetiredAgentReferenceFindings(root, { mode: 'normal', allowlist: [entry] })).toEqual(
      [],
    );
    expect(
      findRetiredAgentReferenceFindings(root, {
        mode: 'normal',
        allowlist: [{ ...entry, fingerprint: normalizedLineFingerprint(`${line} changed`) }],
      }),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ detail: expect.stringContaining('not documented provenance') }),
        expect.objectContaining({ detail: expect.stringContaining('stale') }),
      ]),
    );
  });

  it('refuses an allowlist entry without a non-empty provenance reason', () => {
    const root = workspace();
    const line = `Historical verdict: ${RETIRED_NAME} endorsed the proposal.`;
    file(root, '.agents/memory/history.md', `${line}\n`);
    const findings = findRetiredAgentReferenceFindings(root, {
      mode: 'normal',
      allowlist: [
        {
          file: '.agents/memory/history.md',
          fingerprint: normalizedLineFingerprint(line),
          reason: '',
        },
      ],
    });
    expect(findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ detail: expect.stringContaining('no non-empty reason') }),
        expect.objectContaining({ detail: expect.stringContaining('not documented provenance') }),
      ]),
    );
  });

  it('consumes one provenance entry for exactly one occurrence', () => {
    const root = workspace();
    const line = `Historical verdict: ${RETIRED_NAME} endorsed the proposal.`;
    file(root, '.agents/memory/history.md', `${line}\n${line}\n`);
    const findings = findRetiredAgentReferenceFindings(root, {
      mode: 'normal',
      allowlist: [
        {
          file: '.agents/memory/history.md',
          fingerprint: normalizedLineFingerprint(line),
          reason: 'one dated endorsement occurrence',
        },
      ],
    });

    expect(findings).toEqual([
      expect.objectContaining({
        file: '.agents/memory/history.md',
        detail: expect.stringContaining('not documented provenance'),
      }),
    ]);
  });

  it('covers open Tasks and nonterminal specs but excludes historical trees', () => {
    const root = workspace();
    file(root, '.agents/tasks/OPEN-1.md', `Dispatch ${RETIRED_NAME}.\n`);
    file(root, '.agents/spec-docs/draft/DRAFT-1.md', `Dispatch ${RETIRED_NAME}.\n`);
    file(root, '.agents/spec-docs/backlog/BACKLOG-1.md', `Dispatch ${RETIRED_NAME}.\n`);
    file(root, '.agents/spec-docs/todo/TODO-1.md', `Dispatch ${RETIRED_NAME}.\n`);
    file(root, '.agents/spec-docs/active/ACTIVE-1.md', `Dispatch ${RETIRED_NAME}.\n`);
    file(root, '.agents/spec-docs/done/DONE-1.md', `Dispatch ${RETIRED_NAME}.\n`);
    file(root, '.agents/spec-docs/rejected/REJECTED-1.md', `Dispatch ${RETIRED_NAME}.\n`);
    file(root, '.agents/archive/old.md', `Dispatch ${RETIRED_NAME}.\n`);

    const files = findRetiredAgentReferenceFindings(root, {
      mode: 'normal',
      allowlist: [],
    }).map((finding) => finding.file);
    expect(files).toEqual([
      '.agents/spec-docs/active/ACTIVE-1.md',
      '.agents/spec-docs/backlog/BACKLOG-1.md',
      '.agents/spec-docs/draft/DRAFT-1.md',
      '.agents/spec-docs/todo/TODO-1.md',
      '.agents/tasks/OPEN-1.md',
    ]);
  });
});
