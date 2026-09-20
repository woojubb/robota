import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  correctionCheckpointEvidence,
  continuationCheckpointEvidence,
  firstCheckpointEvidence,
} from '../gate-checkpoint-evidence.mjs';
import {
  formatCheckpointEvidence,
  parseCheckpointEvidence,
  parseCheckpointEvidenceContracts,
  priorPassDigest,
  rawGateImplementPassEntries,
} from '../checkpoint-evidence-contract.mjs';
import { evaluateGateImplementEntries } from '../gate-implement-entry-results.mjs';
import { makeTemp } from './make-temp.mjs';

const root = makeTemp('gate-checkpoint-evidence-');
afterAll(() => rmSync(root, { recursive: true, force: true }));

function git(args) {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr);
}

describe('gate checkpoint evidence renderer', () => {
  beforeEach(() => {
    // This fixture owns origin/develop; a caller's repository base is not its integration ref.
    vi.stubEnv('HARNESS_BASE_REF', undefined);
  });
  afterEach(() => vi.unstubAllEnvs());

  it('renders the declared v2 first-checkpoint payload', () => {
    git(['init', '-q']);
    git(['config', 'user.email', 'fixture@example.com']);
    git(['config', 'user.name', 'Fixture']);
    git(['commit', '--allow-empty', '-q', '-m', 'base']);
    const ruleText = readFileSync(
      path.resolve(import.meta.dirname, '../../../.agents/rules/backlog-execution.md'),
      'utf8',
    );
    const lines = firstCheckpointEvidence({
      root,
      ruleText,
      specText:
        '## Architecture Review\n\n### Decision\n\n**Delivery mode:** `single`\n\n## Completion Criteria\n\n- [ ] TC-01: observable result\n',
      taskText:
        'TC-01\n\n## User Execution Test Scenarios\n\n**Author verdict:** `SCENARIO DRAFTED: not-applicable | 0`\n\n**Reason:** This repository checkpoint fixture exposes no runnable Robota product behavior or user-observable action.',
      taskRel: '.agents/tasks/PROC-999-fixture.md',
      specRel: '.agents/spec-docs/todo/PROC-999-fixture.md',
    });

    expect(lines.join('\n')).toContain('<!-- checkpoint-evidence:v2:start -->');
    expect(lines.join('\n')).toContain('"deliveryMode": "single"');
  });

  it('filters owned lesson churn from a first checkpoint but retains and rejects real dirt', () => {
    const subject = makeTemp('gate-checkpoint-churn-');
    const subjectGit = (args) => {
      const result = spawnSync('git', args, { cwd: subject, encoding: 'utf8' });
      if (result.status !== 0) throw new Error(result.stderr);
    };
    try {
      subjectGit(['init', '-q']);
      subjectGit(['config', 'user.email', 'fixture@example.com']);
      subjectGit(['config', 'user.name', 'Fixture']);
      subjectGit(['commit', '--allow-empty', '-q', '-m', 'base']);
      mkdirSync(path.join(subject, '.agents/evals/lessons'), { recursive: true });
      mkdirSync(path.join(subject, '.agents/spec-docs/todo'), { recursive: true });
      mkdirSync(path.join(subject, '.agents/tasks'), { recursive: true });
      mkdirSync(path.join(subject, 'scripts/harness'), { recursive: true });
      writeFileSync(path.join(subject, '.agents/evals/lessons/auto-lessons.md'), 'generated\n');
      writeFileSync(path.join(subject, '.agents/evals/lessons/weekly-digest.md'), 'generated\n');

      const ruleText = readFileSync(
        path.resolve(import.meta.dirname, '../../../.agents/rules/backlog-execution.md'),
        'utf8',
      );
      const taskRel = '.agents/tasks/DATA-999-fixture.md';
      const specRel = '.agents/spec-docs/todo/DATA-999-fixture.md';
      const specText =
        '## Architecture Review\n\n### Decision\n\n**Delivery mode:** `single`\n\n## Completion Criteria\n\n- [ ] TC-01: observable result\n';
      const taskText =
        'TC-01\n\n## User Execution Test Scenarios\n\n**Author verdict:** `SCENARIO DRAFTED: not-applicable | 0`\n\n**Reason:** This repository checkpoint fixture exposes no runnable Robota product behavior or user-observable action.';
      writeFileSync(path.join(subject, taskRel), taskText);
      writeFileSync(path.join(subject, specRel), specText);

      const render = () =>
        firstCheckpointEvidence({
          root: subject,
          ruleText,
          specText,
          taskText,
          taskRel,
          specRel,
        });
      const lines = render();
      const contract = parseCheckpointEvidenceContracts(ruleText).contracts.get(2);
      const parsed = parseCheckpointEvidence(contract, 'gateImplementFirst', lines.join('\n'));
      expect(parsed.ok, parsed.ok ? '' : parsed.error).toBe(true);
      if (!parsed.ok) return;
      expect(parsed.payload.worktreePaths).toEqual([specRel, taskRel].sort());

      const firstEntry = ['**Status upgrade:** approved → in-progress', ...lines].join('\n');
      const accepted = evaluateGateImplementEntries({
        spec: specText,
        binding: {
          basename: path.basename(taskRel),
          signal: { outcome: 'not-applicable', count: 0 },
        },
        ruleText,
        entries: [firstEntry],
        visibleEntryCount: 1,
      });
      expect(accepted).toHaveLength(1);
      expect(accepted[0].ok, accepted[0].error).toBe(true);

      writeFileSync(path.join(subject, 'scripts/harness/unrelated.mjs'), 'export {};\n');
      const dirtyLines = render();
      const dirtyParsed = parseCheckpointEvidence(
        contract,
        'gateImplementFirst',
        dirtyLines.join('\n'),
      );
      expect(dirtyParsed.ok, dirtyParsed.ok ? '' : dirtyParsed.error).toBe(true);
      if (!dirtyParsed.ok) return;
      expect(dirtyParsed.payload.worktreePaths).toEqual(
        [specRel, taskRel, 'scripts/harness/unrelated.mjs'].sort(),
      );

      const dirtyEntry = ['**Status upgrade:** approved → in-progress', ...dirtyLines].join('\n');
      const rejected = evaluateGateImplementEntries({
        spec: specText,
        binding: {
          basename: path.basename(taskRel),
          signal: { outcome: 'not-applicable', count: 0 },
        },
        ruleText,
        entries: [dirtyEntry],
        visibleEntryCount: 1,
      });
      expect(rejected).toHaveLength(1);
      expect(rejected[0]).toMatchObject({
        ok: false,
        error: expect.stringMatching(/paired Task\/spec plus only PLAN ledger paths/),
      });
    } finally {
      rmSync(subject, { recursive: true, force: true });
    }
  });

  it('fails closed before rendering when the prior raw PASS payload is malformed', () => {
    const ruleText = readFileSync(
      path.resolve(import.meta.dirname, '../../../.agents/rules/backlog-execution.md'),
      'utf8',
    );
    const basename = 'PROC-998-malformed.md';
    const specRel = `.agents/spec-docs/active/${basename}`;
    const specText = [
      '## Architecture Review',
      '',
      '### Decision',
      '',
      '**Delivery mode:** `sequenced`',
      '**Continuation artifacts:** `scripts/harness/gate.mjs`',
      '',
      '## Evidence Log',
      '',
      '### [GATE-IMPLEMENT] — ✅ PASS | 2026-09-01',
      '',
      '**Status upgrade:** approved → in-progress',
      '<!-- checkpoint-evidence:v2:start -->',
      '```json',
      '{}',
      '```',
      '<!-- checkpoint-evidence:v2:end -->',
      '',
    ].join('\n');
    const file = path.join(root, specRel);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, specText);
    git(['add', specRel]);
    git(['commit', '-q', '-m', 'malformed prior']);

    expect(() =>
      continuationCheckpointEvidence({
        root,
        ruleText,
        specText,
        taskText:
          '## User Execution Test Scenarios\n\n**Author verdict:** `SCENARIO DRAFTED: not-applicable | 0`\n\n**Reason:** This internal repository checkpoint fixture exposes no runnable Robota product behavior or observable user action.',
        taskRel: `.agents/tasks/${basename}`,
        specRel,
      }),
    ).toThrow(/prior.*invalid|payload/i);
  });

  it('rejects a canonical prior v2 first payload whose delivery contradicts the Decision', () => {
    const ruleText = readFileSync(
      path.resolve(import.meta.dirname, '../../../.agents/rules/backlog-execution.md'),
      'utf8',
    );
    const basename = 'PROC-997-delivery-mismatch.md';
    const taskRel = `.agents/tasks/${basename}`;
    const specRel = `.agents/spec-docs/active/${basename}`;
    const taskText =
      'TC-01\n\n## User Execution Test Scenarios\n\n**Author verdict:** `SCENARIO DRAFTED: not-applicable | 0`\n\n**Reason:** This internal repository checkpoint fixture exposes no runnable Robota product behavior or observable user action.';
    const payload = {
      version: 2,
      form: 'gateImplementFirst',
      deliveryMode: 'single',
      sequencedArtifacts: [],
      taskPath: taskRel,
      specPath: `.agents/spec-docs/todo/${basename}`,
      taskItems: [{ kind: 'tc-id', value: 'TC-01' }],
      plan: { outcome: 'not-applicable', count: 0 },
      worktreePaths: [taskRel, `.agents/spec-docs/todo/${basename}`].sort(),
    };
    const specText = [
      '## Architecture Review',
      '',
      '### Decision',
      '',
      '**Delivery mode:** `sequenced`',
      '**Continuation artifacts:** `scripts/harness/gate.mjs`',
      '',
      '## Completion Criteria',
      '',
      '- [ ] TC-01: observable result',
      '',
      '## Evidence Log',
      '',
      '### [GATE-IMPLEMENT] — ✅ PASS | 2026-09-01',
      '',
      '**Status upgrade:** approved → in-progress',
      '<!-- checkpoint-evidence:v2:start -->',
      '```json',
      JSON.stringify(payload, null, 2),
      '```',
      '<!-- checkpoint-evidence:v2:end -->',
      '',
    ].join('\n');
    const file = path.join(root, specRel);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, specText);
    git(['add', specRel]);
    git(['commit', '-q', '-m', 'delivery mismatch prior']);

    expect(() =>
      continuationCheckpointEvidence({ root, ruleText, specText, taskText, taskRel, specRel }),
    ).toThrow(/prior.*delivery|Decision/i);
  });

  it('rejects a prior v2 continuation whose artifacts drift from the Decision', () => {
    const ruleText = readFileSync(
      path.resolve(import.meta.dirname, '../../../.agents/rules/backlog-execution.md'),
      'utf8',
    );
    const basename = 'PROC-996-artifact-drift.md';
    const taskRel = `.agents/tasks/${basename}`;
    const specRel = `.agents/spec-docs/active/${basename}`;
    const taskText =
      'TC-01\n\n## User Execution Test Scenarios\n\n**Author verdict:** `SCENARIO DRAFTED: not-applicable | 0`\n\n**Reason:** This internal repository checkpoint fixture exposes no runnable Robota product behavior or observable user action.';
    const evidence = (status, payload) =>
      [
        `### [GATE-IMPLEMENT] — ✅ PASS | 2026-09-01`,
        '',
        `**Status upgrade:** ${status}`,
        '<!-- checkpoint-evidence:v2:start -->',
        '```json',
        JSON.stringify(payload, null, 2),
        '```',
        '<!-- checkpoint-evidence:v2:end -->',
      ].join('\n');
    const first = evidence('approved → in-progress', {
      version: 2,
      form: 'gateImplementFirst',
      deliveryMode: 'sequenced',
      sequencedArtifacts: ['scripts/harness/gate.mjs'],
      taskPath: taskRel,
      specPath: `.agents/spec-docs/todo/${basename}`,
      taskItems: [{ kind: 'tc-id', value: 'TC-01' }],
      plan: { outcome: 'not-applicable', count: 0 },
      worktreePaths: [taskRel, `.agents/spec-docs/todo/${basename}`].sort(),
    });
    const specPrefix = [
      '## Architecture Review',
      '',
      '### Decision',
      '',
      '**Delivery mode:** `sequenced`',
      '**Continuation artifacts:** `scripts/harness/gate.mjs`',
      '',
      '## Completion Criteria',
      '',
      '- [ ] TC-01: observable result',
      '',
      '## Evidence Log',
      '',
      first,
      '',
    ].join('\n');
    const firstRaw = rawGateImplementPassEntries(specPrefix)[0];
    const continuation = evidence('in-progress → in-progress (continuation)', {
      version: 2,
      form: 'gateImplementContinuation',
      deliveryMode: 'sequenced',
      sequencedArtifacts: ['scripts/harness/checkpoint-evidence-contract.mjs'],
      priorPass: priorPassDigest(firstRaw),
      ancestorSha: 'a'.repeat(40),
      taskPath: taskRel,
      specPath: specRel,
      plan: { outcome: 'not-applicable', count: 0 },
      worktreePaths: [taskRel, specRel].sort(),
    });
    const specText = `${specPrefix}${continuation}\n`;
    const file = path.join(root, specRel);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, specText);
    git(['add', specRel]);
    git(['commit', '-q', '-m', 'artifact drift prior']);

    expect(() =>
      continuationCheckpointEvidence({ root, ruleText, specText, taskText, taskRel, specRel }),
    ).toThrow(/prior.*delivery|Decision/i);
  });

  it('rejects a legacy v1 first PASS whose sequenced Decision was added only later', () => {
    const ruleText = readFileSync(
      path.resolve(import.meta.dirname, '../../../.agents/rules/backlog-execution.md'),
      'utf8',
    );
    const basename = 'PROC-995-post-hoc-v1-delivery.md';
    const taskRel = `.agents/tasks/${basename}`;
    const specRel = `.agents/spec-docs/active/${basename}`;
    const taskText =
      '---\nstatus: in-progress\n---\n\nTC-01\n\n## User Execution Test Scenarios\n\n**Author verdict:** `SCENARIO DRAFTED: not-applicable | 0`\n\n**Reason:** This internal repository checkpoint fixture exposes no runnable Robota product behavior or observable user action.';
    const contract = parseCheckpointEvidenceContracts(ruleText).contracts.get(1);
    const rendered = formatCheckpointEvidence(contract, 'gateImplementFirst', {
      version: 1,
      form: 'gateImplementFirst',
      taskPath: taskRel,
      specPath: `.agents/spec-docs/todo/${basename}`,
      taskItems: [{ kind: 'tc-id', value: 'TC-01' }],
      plan: { outcome: 'not-applicable', count: 0 },
      worktreePaths: [taskRel, `.agents/spec-docs/todo/${basename}`].sort(),
    });
    if (!rendered.ok) throw new Error(rendered.error);
    const introducedSpec = [
      '## Architecture Review',
      '',
      '### Decision',
      '',
      '**Delivery mode:** `single`',
      '',
      '## Completion Criteria',
      '',
      '- [ ] TC-01: observable result',
      '',
      '## Evidence Log',
      '',
      '### [GATE-IMPLEMENT] — ✅ PASS | 2026-09-01',
      '',
      '**Status upgrade:** approved → in-progress',
      rendered.text,
      '',
    ].join('\n');
    const file = path.join(root, specRel);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, introducedSpec);
    git(['add', specRel]);
    git(['commit', '-q', '-m', 'legacy v1 first checkpoint']);

    const specText = introducedSpec.replace(
      '**Delivery mode:** `single`',
      '**Delivery mode:** `sequenced`\n**Continuation artifacts:** `scripts/harness/gate.mjs`',
    );
    writeFileSync(file, specText);
    git(['add', specRel]);
    git(['commit', '-q', '-m', 'post-hoc sequenced Decision']);

    expect(() =>
      continuationCheckpointEvidence({ root, ruleText, specText, taskText, taskRel, specRel }),
    ).toThrow(/historical.*Decision|corrective checkpoint/i);

    mkdirSync(path.join(root, '.agents/evals/lessons'), { recursive: true });
    writeFileSync(path.join(root, '.agents/evals/lessons/auto-lessons.md'), 'generated\n');
    writeFileSync(path.join(root, '.agents/evals/lessons/weekly-digest.md'), 'generated\n');

    const correctionLines = correctionCheckpointEvidence({
      root,
      ruleText,
      specText,
      taskText,
      taskRel,
      specRel,
    });
    const correctionBody = [
      '### [GATE-IMPLEMENT] — ✅ PASS | 2026-09-02',
      '',
      '**Status upgrade:** in-progress → in-progress (correction)',
      '',
      ...correctionLines,
      '',
    ].join('\n');
    const correctedSpec = `${specText}${correctionBody}`;
    writeFileSync(file, correctedSpec);
    git(['add', specRel]);
    git(['commit', '-q', '-m', 'explicit correction checkpoint']);

    const correctionRaw = rawGateImplementPassEntries(correctedSpec).at(-1);
    const correctionContract = parseCheckpointEvidenceContracts(ruleText).contracts.get(2);
    const parsedCorrection = parseCheckpointEvidence(
      correctionContract,
      'gateImplementCorrection',
      correctionRaw,
    );
    expect(parsedCorrection.ok, parsedCorrection.ok ? '' : parsedCorrection.error).toBe(true);
    expect(parsedCorrection.payload).toMatchObject({
      deliveryMode: 'sequenced',
      priorPass: priorPassDigest(rawGateImplementPassEntries(specText)[0]),
      firstPassIntroductionSha: expect.stringMatching(/^[0-9a-f]{40}$/),
      worktreePaths: [specRel, taskRel].sort(),
    });

    expect(() =>
      continuationCheckpointEvidence({
        root,
        ruleText,
        specText: correctedSpec,
        taskText,
        taskRel,
        specRel,
      }),
    ).toThrow(/correction.*not yet on integration base/i);
    git(['update-ref', 'refs/remotes/origin/develop', 'HEAD']);

    const continuationLines = continuationCheckpointEvidence({
      root,
      ruleText,
      specText: correctedSpec,
      taskText,
      taskRel,
      specRel,
    });
    expect(continuationLines.join('\n')).toContain('"form": "gateImplementContinuation"');
    expect(continuationLines.join('\n')).toContain(
      `"priorPass": "${priorPassDigest(correctionRaw)}"`,
    );
    const parsedContinuation = parseCheckpointEvidence(
      correctionContract,
      'gateImplementContinuation',
      continuationLines.join('\n'),
    );
    expect(parsedContinuation.ok, parsedContinuation.ok ? '' : parsedContinuation.error).toBe(true);
    if (!parsedContinuation.ok) return;
    expect(parsedContinuation.payload.worktreePaths).toEqual([specRel, taskRel].sort());
  });
});
// harness-coverage: gate-checkpoint-evidence-common.mjs
// harness-coverage: gate-correction-checkpoint-evidence.mjs
