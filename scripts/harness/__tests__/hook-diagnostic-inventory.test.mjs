import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { collectHookRegistrationFacts } from '../hook-registration-facts.mjs';
import {
  loadHookDiagnosticMigrationManifest,
  validateHookDiagnosticMigrationManifest,
} from '../hook-diagnostic-inventory.mjs';
import { SCAN_COMMANDS } from '../run-all-scans.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

function readJson(relativePath) {
  return JSON.parse(readFileSync(path.join(ROOT, relativePath), 'utf8'));
}

describe('hook diagnostic migration inventory', () => {
  it('declares every live scan, PreTool registration, Husky veto path, and required status context', () => {
    const manifest = loadHookDiagnosticMigrationManifest(ROOT);
    const settings = readJson('.claude/settings.json');
    const requiredChecks = readJson('.github/required-status-checks.json');

    expect(validateHookDiagnosticMigrationManifest(manifest)).toEqual(manifest);
    expect(manifest.scanRegistrations.map((record) => record.subject.value).sort()).toEqual(
      SCAN_COMMANDS.map((scan) => scan.name).sort(),
    );
    expect(manifest.preToolRegistrations.map((record) => record.registration)).toEqual(
      collectHookRegistrationFacts(settings).filter(({ event }) => event === 'PreToolUse'),
    );
    expect(manifest.huskyVetoPaths.map((record) => record.vetoPath)).toEqual([
      { entrypoint: 'commit-msg', pathId: 'commitlint-edit', predicate: 'commitlint-edit' },
      {
        entrypoint: 'pre-commit',
        pathId: 'protected-branch',
        predicate: 'protected-branch-direct-commit',
      },
      { entrypoint: 'pre-commit', pathId: 'lessons', predicate: 'staged-generated-lessons' },
      {
        entrypoint: 'pre-commit',
        pathId: 'planning-order',
        predicate: 'user-execution-plan-order',
      },
      { entrypoint: 'pre-commit', pathId: 'lint-staged', predicate: 'lint-staged-success' },
      { entrypoint: 'pre-push', pathId: 'pre-push', predicate: 'harness-pre-push' },
      {
        entrypoint: '_/post-checkout',
        pathId: 'target-executable',
        predicate: 'tracked-target-executable',
      },
      {
        entrypoint: '_/post-checkout.fallback',
        pathId: 'target-executable',
        predicate: 'tracked-target-executable',
      },
      {
        entrypoint: '_/pre-push',
        pathId: 'target-executable',
        predicate: 'tracked-target-executable',
      },
      {
        entrypoint: '_/pre-push.fallback',
        pathId: 'target-executable',
        predicate: 'tracked-target-executable',
      },
      {
        entrypoint: '_/prepare-commit-msg',
        pathId: 'target-executable',
        predicate: 'tracked-target-executable',
      },
      {
        entrypoint: '_/prepare-commit-msg.fallback',
        pathId: 'target-executable',
        predicate: 'tracked-target-executable',
      },
    ]);
    expect(manifest.requiredStatusContexts.map((record) => record.subject.value).sort()).toEqual(
      Object.entries(requiredChecks.branches)
        .flatMap(([branch, declaration]) =>
          declaration.required_status_checks.map(({ context }) => `${branch}:${context}`),
        )
        .sort(),
    );
  });

  it('rejects a retained veto declaration that lacks its irreversible-risk evidence', () => {
    const manifest = structuredClone(loadHookDiagnosticMigrationManifest(ROOT));
    manifest.huskyVetoPaths[0].disposition = {
      kind: 'retained',
      irreversibleRisk: 'fixture risk',
      redactionPolicy: 'fixture redaction',
      preDenialReportId: 'fixture.pre-denial',
    };

    expect(() => validateHookDiagnosticMigrationManifest(manifest)).toThrow(
      /independentVerification/,
    );
  });
});
