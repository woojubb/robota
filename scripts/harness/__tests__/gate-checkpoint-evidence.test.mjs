import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

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
import { makeTemp } from './make-temp.mjs';

const root = makeTemp('gate-checkpoint-evidence-');
afterAll(() => rmSync(root, { recursive: true, force: true }));

function git(args) {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr);
}

describe('gate checkpoint evidence renderer', () => {
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
  });
});
