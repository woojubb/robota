import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  clearRegisteredToolProfiles,
  evaluatePermission,
  registerToolPermissionProfile,
} from '../permission-gate';
import { RISK_CLASS_POLICY, UNCLASSIFIED_TOOL_FALLBACK } from '../permission-mode';

import type { TToolRiskClass } from '../permission-mode';
import type { TPermissionMode } from '../types';

/**
 * CORE-030 — what a permission MODE decides, which is all this package owns.
 *
 * This file used to assert that `WebFetch` and `WebSearch` are auto in every mode. That is a fact
 * about those TOOLS, and it was assertable here only because the foundation held a table of product
 * tool names — the arrangement this item removed. Which class a tool belongs to is now asserted
 * where the tool is defined (`packages/agent-tools/src/__tests__/tool-permission-profiles.test.ts`);
 * what belongs here is the policy those classes are decided by.
 */

const ALL_MODES: TPermissionMode[] = ['plan', 'default', 'acceptEdits', 'bypassPermissions'];
const ALL_CLASSES: TToolRiskClass[] = ['inspect', 'modify', 'execute'];

describe('permission mode policy (CORE-030)', () => {
  beforeEach(() => {
    clearRegisteredToolProfiles();
  });

  afterEach(() => {
    clearRegisteredToolProfiles();
  });

  it('every mode says something about every class', () => {
    // A missing cell would silently take the unclassified fallback for a tool that IS classified,
    // which is the failure this table exists to make impossible.
    for (const mode of ALL_MODES) {
      for (const riskClass of ALL_CLASSES) {
        expect(RISK_CLASS_POLICY[mode][riskClass], `${mode}/${riskClass}`).toBeDefined();
      }
    }
  });

  it('inspection never needs approval, in any mode', () => {
    // Including `plan`: a mode whose promise is "change nothing" has no reason to refuse a read,
    // and refusing one would make the mode useless for the only thing it permits.
    registerToolPermissionProfile('AnyReadOnlyTool', { riskClass: 'inspect' });
    for (const mode of ALL_MODES) {
      expect(evaluatePermission('AnyReadOnlyTool', {}, mode), mode).toBe('auto');
    }
  });

  it('plan refuses anything that changes or runs', () => {
    registerToolPermissionProfile('AnyWriter', { riskClass: 'modify' });
    registerToolPermissionProfile('AnyRunner', { riskClass: 'execute' });
    expect(evaluatePermission('AnyWriter', {}, 'plan')).toBe('deny');
    expect(evaluatePermission('AnyRunner', {}, 'plan')).toBe('deny');
  });

  it('acceptEdits stops asking about changes but NOT about execution', () => {
    // The distinction the mode exists for. Collapsing the two classes would make accepting edits
    // silently accept arbitrary commands.
    registerToolPermissionProfile('AnyWriter', { riskClass: 'modify' });
    registerToolPermissionProfile('AnyRunner', { riskClass: 'execute' });
    expect(evaluatePermission('AnyWriter', {}, 'acceptEdits')).toBe('auto');
    expect(evaluatePermission('AnyRunner', {}, 'acceptEdits')).toBe('approve');
  });

  it('default asks about both, and bypass asks about neither', () => {
    registerToolPermissionProfile('AnyWriter', { riskClass: 'modify' });
    registerToolPermissionProfile('AnyRunner', { riskClass: 'execute' });
    expect(evaluatePermission('AnyWriter', {}, 'default')).toBe('approve');
    expect(evaluatePermission('AnyRunner', {}, 'default')).toBe('approve');
    expect(evaluatePermission('AnyWriter', {}, 'bypassPermissions')).toBe('auto');
    expect(evaluatePermission('AnyRunner', {}, 'bypassPermissions')).toBe('auto');
  });

  it('a tool whose owner declared nothing is asked about, never auto-run', () => {
    // Fail-safe, and the reason an unclassified tool is a finding rather than a shrug: it is not
    // dangerous, it is unusable in plan and noisy everywhere else.
    for (const mode of ALL_MODES) {
      expect(evaluatePermission('NobodyDeclaredThis', {}, mode), mode).toBe(
        UNCLASSIFIED_TOOL_FALLBACK[mode],
      );
    }
    expect(UNCLASSIFIED_TOOL_FALLBACK.default).toBe('approve');
    expect(UNCLASSIFIED_TOOL_FALLBACK.plan).toBe('deny');
    expect(UNCLASSIFIED_TOOL_FALLBACK.acceptEdits).toBe('approve');
  });

  it('names no product tool', () => {
    // The thesis of CORE-030, asserted mechanically: this package cannot know a product's tool
    // inventory, and every attempt to hold one drifted from the tools actually produced.
    const policyKeys = new Set(Object.values(RISK_CLASS_POLICY).flatMap((row) => Object.keys(row)));
    expect([...policyKeys].sort()).toEqual(['execute', 'inspect', 'modify']);
  });
});
