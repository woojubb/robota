import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import * as prePushFacade from '../pre-push.mjs';
import * as prePushMirror from '../pre-push-ci-mirror.mjs';
import * as prePushRuntime from '../pre-push-runtime.mjs';
import * as verifyFacade from '../verify-like-ci.mjs';
import * as verifyExecution from '../verify-like-ci-execution.mjs';
import * as verifyFormat from '../verify-like-ci-format.mjs';
import * as verifyProduct from '../verify-like-ci-product.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const lines = (name) => readFileSync(path.join(ROOT, name), 'utf8').split('\n').length;

describe('harness entrypoint boundaries', () => {
  it('keeps the two public CLI facades comfortably below 300 lines', () => {
    expect(lines('verify-like-ci.mjs')).toBeLessThan(300);
    expect(lines('pre-push.mjs')).toBeLessThan(300);
  });

  it('preserves verify-like-ci public exports through the facade', () => {
    expect(Object.keys(verifyFacade)).toEqual(
      expect.arrayContaining([
        'CI_STAGES',
        'NOT_MIRRORED',
        'WORKSPACE_ROOT',
        'advanceBuildState',
        'annotateNotMirrored',
        'classifyLocalProductChanges',
        'collectChangedFiles',
        'createProductStageCommands',
        'describeAffectedScopes',
        'findMissingDist',
        'firstParentCommits',
        'globExtensions',
        'initialBuildState',
        'lintStagedExtensions',
        'listBuildablePackageDirs',
        'listNodeModulesOwners',
        'main',
        'parseArgs',
        'parseDistIndependentScanSkips',
        'parseGitFileList',
        'preflight',
        'readDistIndependentScanSkips',
        'readLintStagedExtensions',
        'resolveRunContext',
        'selectFormatTargets',
        'stageBlockCause',
        'stageGate',
        'summarize',
      ]),
    );
    expect(verifyFacade.main).toBe(verifyExecution.main);
    expect(verifyFacade.CI_STAGES).toBe(verifyExecution.CI_STAGES);
    expect(verifyFacade.globExtensions).toBe(verifyFormat.globExtensions);
    expect(verifyFacade.stageGate).toBe(verifyProduct.stageGate);
  });

  it('preserves pre-push public exports through the facade', () => {
    expect(Object.keys(prePushFacade)).toEqual(
      expect.arrayContaining([
        'CI_BASE_REF_PLACEHOLDER',
        'CI_HEAD_REF_PLACEHOLDER',
        'CI_SCANS_JOB_MIRROR',
        'createCiScansJobMirror',
        'createPrePushSteps',
        'createWorkRunMeasurementInput',
        'prerequisitesFor',
        'runPostVerdictGuard',
        'runPrePushGate',
      ]),
    );
    expect(prePushFacade.createCiScansJobMirror).toBe(prePushMirror.createCiScansJobMirror);
    expect(prePushFacade.createPrePushSteps).toBe(prePushRuntime.createPrePushSteps);
    expect(prePushFacade.CI_SCANS_JOB_MIRROR).toBe(prePushMirror.CI_SCANS_JOB_MIRROR);
  });
});
