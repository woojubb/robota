import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  continuationArtifacts,
  formatCheckpointEvidence,
  parseCheckpointEvidence,
  parseCheckpointEvidenceContract,
  priorPassDigest,
  rawGateImplementPassEntries,
} from '../checkpoint-evidence-contract.mjs';

const WORKSPACE_ROOT = path.resolve(import.meta.dirname, '../../..');

describe('checkpoint evidence contract', () => {
  it('parses one v1 declaration from the owning rule (TC-01)', () => {
    const rule = readFileSync(
      path.join(WORKSPACE_ROOT, '.agents/rules/backlog-execution.md'),
      'utf8',
    );

    const parsed = parseCheckpointEvidenceContract(rule);

    expect(parsed.ok, parsed.ok ? '' : parsed.error).toBe(true);
    expect(parsed.contract.version).toBe(1);
    expect(Object.keys(parsed.contract.forms)).toEqual([
      'gateImplementFirst',
      'gateImplementContinuation',
      'doneGateStageOne',
    ]);
    const catalogue = readFileSync(
      path.join(WORKSPACE_ROOT, '.agents/specs/gate-catalogue.md'),
      'utf8',
    );
    expect(catalogue).toContain('[`backlog-execution.md`](../rules/backlog-execution.md)');
    for (const formName of Object.keys(parsed.contract.forms))
      expect(catalogue).toContain(formName);
    expect(catalogue).not.toContain('checkpoint-evidence-contract:v1:start');
    expect(catalogue).not.toContain('"payloadKeys"');
  });

  it('rejects duplicate JSON members and unknown top-level fields by name (TC-02)', () => {
    const rule = readFileSync(
      path.join(WORKSPACE_ROOT, '.agents/rules/backlog-execution.md'),
      'utf8',
    );
    const duplicate = rule.replace('"version": 1,', '"version": 1,\n  "version": 1,');
    const unknown = rule.replace('"version": 1,', '"version": 1,\n  "unexpected": true,');

    expect(parseCheckpointEvidenceContract(duplicate)).toMatchObject({
      ok: false,
      error: expect.stringMatching(/duplicate.*version/i),
    });
    expect(parseCheckpointEvidenceContract(unknown)).toMatchObject({
      ok: false,
      error: expect.stringMatching(/unknown.*unexpected/i),
    });
  });

  it.each([
    ['unsupported version', '"version": 1,', '"version": 2,', /version/i],
    [
      'mutated first folder',
      '"specFolder": "todo"',
      '"specFolder": "active"',
      /gateImplementFirst.*specFolder/i,
    ],
    [
      'missing action mapping',
      '    "manual:robota-tui": "uiSteps",\n    "manual:robota-browser-ui": "uiSteps"',
      '    "manual:robota-tui": "uiSteps"',
      /actionMapping.*manual:robota-browser-ui/i,
    ],
    [
      'duplicated scenario key',
      '        "surface",\n',
      '        "surface",\n        "surface",\n',
      /scenarioKeys.*duplicate/i,
    ],
  ])('rejects a %s declaration mutation by member (TC-02)', (_name, from, to, expected) => {
    const rule = readFileSync(
      path.join(WORKSPACE_ROOT, '.agents/rules/backlog-execution.md'),
      'utf8',
    );
    expect(parseCheckpointEvidenceContract(rule.replace(from, to))).toMatchObject({
      ok: false,
      error: expect.stringMatching(expected),
    });
  });

  it('round-trips the declared first-checkpoint payload and rejects reordered keys (TC-03)', () => {
    const rule = readFileSync(
      path.join(WORKSPACE_ROOT, '.agents/rules/backlog-execution.md'),
      'utf8',
    );
    const { contract } = parseCheckpointEvidenceContract(rule);
    const payload = {
      version: 1,
      form: 'gateImplementFirst',
      taskPath: '.agents/tasks/INFRA-999-fixture.md',
      specPath: '.agents/spec-docs/todo/INFRA-999-fixture.md',
      taskItems: [{ kind: 'tc-id', value: 'TC-01' }],
      plan: { outcome: 'not-applicable', count: 0 },
      worktreePaths: [
        '.agents/spec-docs/todo/INFRA-999-fixture.md',
        '.agents/tasks/INFRA-999-fixture.md',
      ],
    };

    const rendered = formatCheckpointEvidence(contract, 'gateImplementFirst', payload);
    expect(rendered.ok, rendered.ok ? '' : rendered.error).toBe(true);
    expect(parseCheckpointEvidence(contract, 'gateImplementFirst', rendered.text)).toEqual({
      ok: true,
      payload,
    });

    const reordered = rendered.text.replace(
      '"version": 1,\n  "form": "gateImplementFirst",',
      '"form": "gateImplementFirst",\n  "version": 1,',
    );
    expect(parseCheckpointEvidence(contract, 'gateImplementFirst', reordered)).toMatchObject({
      ok: false,
      error: expect.stringMatching(/order/i),
    });
  });

  it('binds continuation raw bytes, Decision artifacts, folder, and ancestry fields (TC-04, TC-07)', () => {
    const rule = readFileSync(
      path.join(WORKSPACE_ROOT, '.agents/rules/backlog-execution.md'),
      'utf8',
    );
    const { contract } = parseCheckpointEvidenceContract(rule);
    const priorSpec = [
      '## Evidence Log',
      '',
      '### [GATE-IMPLEMENT] — ✅ PASS | 2026-08-20',
      '',
      '**Status upgrade:** approved → in-progress',
      '',
      'raw evidence  ',
      '',
      '## Next',
    ].join('\n');
    const raw = rawGateImplementPassEntries(priorSpec)[0];
    expect(priorPassDigest(raw)).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(priorPassDigest(raw)).not.toBe(priorPassDigest(raw.replace('  \n', '\n')));

    const spec = [
      '## Architecture Review',
      '',
      '### Decision',
      '',
      '**Continuation artifacts:** `scripts/harness/gate.mjs`, `scripts/harness/scan-user-execution-plan-order.mjs`',
    ].join('\n');
    expect(continuationArtifacts(contract, spec)).toEqual({
      ok: true,
      artifacts: ['scripts/harness/gate.mjs', 'scripts/harness/scan-user-execution-plan-order.mjs'],
    });

    const payload = {
      version: 1,
      form: 'gateImplementContinuation',
      priorPass: priorPassDigest(raw),
      sequencedArtifacts: [
        'scripts/harness/gate.mjs',
        'scripts/harness/scan-user-execution-plan-order.mjs',
      ],
      ancestorSha: 'a'.repeat(40),
      taskPath: '.agents/tasks/INFRA-999-fixture.md',
      specPath: '.agents/spec-docs/active/INFRA-999-fixture.md',
      plan: { outcome: 'not-applicable', count: 0 },
      worktreePaths: [],
    };
    const rendered = formatCheckpointEvidence(contract, 'gateImplementContinuation', payload);
    expect(rendered.ok, rendered.ok ? '' : rendered.error).toBe(true);
    expect(parseCheckpointEvidence(contract, 'gateImplementContinuation', rendered.text)).toEqual({
      ok: true,
      payload,
    });
    expect(
      formatCheckpointEvidence(contract, 'gateImplementContinuation', {
        ...payload,
        specPath: '.agents/spec-docs/todo/INFRA-999-fixture.md',
      }),
    ).toMatchObject({ ok: false, error: expect.stringMatching(/active/) });
  });

  it('enforces the Stage-1 closed fields and manual-TUI action mapping (TC-05)', () => {
    const rule = readFileSync(
      path.join(WORKSPACE_ROOT, '.agents/rules/backlog-execution.md'),
      'utf8',
    );
    const { contract } = parseCheckpointEvidenceContract(rule);
    const scenario = {
      name: 'Scenario 1: interactive fixture',
      surface: 'robota-tui',
      surfaceRationale: 'shipped-entrypoint=robota',
      invocation: 'robota fixture',
      observableType: 'ui-state',
      observable: 'visible=fixture active',
      observableRationale: 'source=rendered-product-ui',
      guardianObservableVerdict: 'product-behavior',
      executability: 'manual-only: terminal interaction',
      prerequisite: 'fixture repository initialized',
      action: { kind: 'uiSteps', value: 'press Enter' },
      expectedObservable: 'visible=fixture active',
      cleanup: 'none',
      evidence: 'pending',
      barrier: 'accessibility-tree-unavailable',
      unavailableCapability: 'terminal accessibility tree is unavailable',
      attemptedAutomation: 'scripted input could not observe rendered terminal state',
      uiSteps: 'press Enter',
    };
    const payload = {
      version: 1,
      form: 'doneGateStageOne',
      outcome: 'manual',
      scenarios: [scenario],
    };
    const rendered = formatCheckpointEvidence(contract, 'doneGateStageOne', payload);
    expect(rendered.ok, rendered.ok ? '' : rendered.error).toBe(true);
    expect(parseCheckpointEvidence(contract, 'doneGateStageOne', rendered.text)).toEqual({
      ok: true,
      payload,
    });
    expect(
      formatCheckpointEvidence(contract, 'doneGateStageOne', {
        ...payload,
        scenarios: [{ ...scenario, action: { kind: 'command', value: 'robota fixture' } }],
      }),
    ).toMatchObject({ ok: false, error: expect.stringMatching(/action\.kind.*uiSteps/) });
    const { barrier: _barrier, ...missingBarrier } = scenario;
    expect(
      formatCheckpointEvidence(contract, 'doneGateStageOne', {
        ...payload,
        scenarios: [missingBarrier],
      }),
    ).toMatchObject({ ok: false, error: expect.stringMatching(/barrier/) });
  });
});
