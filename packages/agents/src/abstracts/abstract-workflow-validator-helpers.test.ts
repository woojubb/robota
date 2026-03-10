import { describe, it, expect } from 'vitest';
import {
    createValidationResultHelper,
    createFailureResultHelper,
    updateStatisticsHelper,
    buildValidatorStatsOutput,
    filterIssuesHelper,
    getEnabledRulesHelper,
    extractSimpleData
} from './abstract-workflow-validator-helpers';
import { ValidationSeverity } from '../interfaces/workflow-validator';
import type { IValidationIssue } from '../interfaces/workflow-validator';
import type { IValidatorStats, IValidationRuleConfig } from './abstract-workflow-validator';

function makeIssue(rule: string, severity: ValidationSeverity): IValidationIssue {
    return { id: `issue-${rule}`, severity, message: `Issue in ${rule}`, rule, detectedAt: new Date() };
}

const dataStatsGetter = (d: Record<string, string | number | boolean>) => d;

describe('abstract-workflow-validator-helpers', () => {
    describe('createValidationResultHelper', () => {
        it('creates a valid result with no errors', () => {
            const result = createValidationResultHelper(
                ['rule-a'], Date.now(), {}, {}, [], 'test', '1.0.0', dataStatsGetter
            );
            expect(result.isValid).toBe(true);
            expect(result.summary.totalIssues).toBe(0);
        });

        it('creates invalid result when errors present', () => {
            const issues = [makeIssue('rule-a', ValidationSeverity.ERROR)];
            const result = createValidationResultHelper(
                ['rule-a'], Date.now(), {}, {}, issues, 'test', '1.0.0', dataStatsGetter
            );
            expect(result.isValid).toBe(false);
            expect(result.summary.errorCount).toBe(1);
        });

        it('marks invalid in strict mode with warnings', () => {
            const issues = [makeIssue('rule-a', ValidationSeverity.WARNING)];
            const result = createValidationResultHelper(
                ['rule-a'], Date.now(), {}, { strict: true }, issues, 'test', '1.0.0', dataStatsGetter
            );
            expect(result.isValid).toBe(false);
        });
    });

    describe('createFailureResultHelper', () => {
        it('creates a failure result', () => {
            const result = createFailureResultHelper(
                new Error('boom'), Date.now(), {}, 'test', '1.0.0', dataStatsGetter
            );
            expect(result.isValid).toBe(false);
            expect(result.summary.errorCount).toBe(1);
            expect(result.issues[0].message).toContain('error');
        });
    });

    describe('updateStatisticsHelper', () => {
        it('increments success for valid result', () => {
            const stats: IValidatorStats = {
                totalValidations: 1, successfulValidations: 0, failedValidations: 0,
                totalProcessingTime: 0, totalIssueCount: 0,
                issuesByRule: new Map(), issuesBySeverity: new Map()
            };
            const result = createValidationResultHelper(
                [], Date.now(), {}, {}, [], 'test', '1.0.0', dataStatsGetter
            );
            updateStatisticsHelper(stats, result);
            expect(stats.successfulValidations).toBe(1);
        });

        it('increments failure for invalid result', () => {
            const stats: IValidatorStats = {
                totalValidations: 1, successfulValidations: 0, failedValidations: 0,
                totalProcessingTime: 0, totalIssueCount: 0,
                issuesByRule: new Map(), issuesBySeverity: new Map()
            };
            const issues = [makeIssue('r', ValidationSeverity.ERROR)];
            const result = createValidationResultHelper(
                ['r'], Date.now(), {}, {}, issues, 'test', '1.0.0', dataStatsGetter
            );
            updateStatisticsHelper(stats, result);
            expect(stats.failedValidations).toBe(1);
            expect(stats.issuesByRule.get('r')).toBe(1);
        });
    });

    describe('buildValidatorStatsOutput', () => {
        it('returns zeroed output for empty stats', () => {
            const stats: IValidatorStats = {
                totalValidations: 0, successfulValidations: 0, failedValidations: 0,
                totalProcessingTime: 0, totalIssueCount: 0,
                issuesByRule: new Map(), issuesBySeverity: new Map()
            };
            const output = buildValidatorStatsOutput(stats, new Map());
            expect(output.averageProcessingTime).toBe(0);
            expect(output.mostCommonIssues).toEqual([]);
        });
    });

    describe('filterIssuesHelper', () => {
        const issues = [
            makeIssue('r1', ValidationSeverity.ERROR),
            makeIssue('r2', ValidationSeverity.WARNING),
            makeIssue('r3', ValidationSeverity.INFO)
        ];

        it('filters out warnings when includeWarnings is false', () => {
            const result = filterIssuesHelper(issues, { includeWarnings: false });
            expect(result.some(i => i.severity === ValidationSeverity.WARNING)).toBe(false);
        });

        it('filters out info when includeInfo is false', () => {
            const result = filterIssuesHelper(issues, { includeInfo: false });
            expect(result.some(i => i.severity === ValidationSeverity.INFO)).toBe(false);
        });

        it('limits errors when maxErrors is set', () => {
            const manyErrors = Array.from({ length: 5 }, (_, i) => makeIssue(`e${i}`, ValidationSeverity.ERROR));
            const result = filterIssuesHelper(manyErrors, { maxErrors: 2 });
            expect(result.filter(i => i.severity === ValidationSeverity.ERROR)).toHaveLength(2);
        });
    });

    describe('getEnabledRulesHelper', () => {
        const configs = new Map<string, IValidationRuleConfig>();
        configs.set('a', { enabled: true, description: 'A', severity: ValidationSeverity.ERROR, category: 'x' });
        configs.set('b', { enabled: false, description: 'B', severity: ValidationSeverity.WARNING, category: 'x' });
        configs.set('c', { enabled: true, description: 'C', severity: ValidationSeverity.ERROR, category: 'x' });

        it('filters out disabled rules', () => {
            const rules = getEnabledRulesHelper(['a', 'b', 'c'], configs, {});
            expect(rules).toContain('a');
            expect(rules).not.toContain('b');
            expect(rules).toContain('c');
        });

        it('skips rules specified in skipRules', () => {
            const rules = getEnabledRulesHelper(['a', 'b', 'c'], configs, { skipRules: ['a'] });
            expect(rules).not.toContain('a');
        });

        it('only includes rules specified in includeRules', () => {
            const rules = getEnabledRulesHelper(['a', 'b', 'c'], configs, { includeRules: ['a'] });
            expect(rules).toEqual(['a']);
        });
    });

    describe('extractSimpleData', () => {
        it('extracts array counts from data', () => {
            const data = { nodes: [1, 2], edges: [3] } as any;
            const result = extractSimpleData(data);
            expect(result['nodes']).toBe(2);
            expect(result['edges']).toBe(1);
        });

        it('returns empty for null data', () => {
            const result = extractSimpleData(null as any);
            expect(result).toEqual({});
        });
    });
});
