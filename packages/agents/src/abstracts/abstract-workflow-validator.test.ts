import { describe, it, expect, beforeEach } from 'vitest';
import { AbstractWorkflowValidator, type IValidationRuleConfig } from './abstract-workflow-validator';
import type { IWorkflowData } from '../interfaces/workflow-converter';
import { ValidationSeverity, type IValidationIssue, type IValidationOptions } from '../interfaces/workflow-validator';

interface ITestData extends IWorkflowData {
    value: string;
}

class TestValidator extends AbstractWorkflowValidator<ITestData> {
    readonly name = 'test-validator';
    readonly version = '1.0.0';
    readonly dataFormat = 'test';
    readonly availableRules = ['rule-a', 'rule-b'];

    shouldFailRule = false;
    shouldThrowRule = false;

    protected initializeRuleConfigs(): void {
        this.ruleConfigs.set('rule-a', { enabled: true, description: 'Rule A', severity: ValidationSeverity.ERROR, category: 'structure' });
        this.ruleConfigs.set('rule-b', { enabled: true, description: 'Rule B', severity: ValidationSeverity.WARNING, category: 'style' });
    }

    protected async performRuleValidation(data: ITestData, rule: string): Promise<{ issues: IValidationIssue[] }> {
        if (this.shouldThrowRule) throw new Error('rule execution error');
        if (this.shouldFailRule && rule === 'rule-a') {
            return {
                issues: [{
                    id: 'issue-1', severity: ValidationSeverity.ERROR,
                    message: 'Value is invalid', rule: 'rule-a', detectedAt: new Date()
                }]
            };
        }
        return { issues: [] };
    }
}

describe('AbstractWorkflowValidator', () => {
    let validator: TestValidator;

    beforeEach(() => {
        validator = new TestValidator();
    });

    describe('validate', () => {
        it('validates successfully with no issues', async () => {
            const result = await validator.validate({ value: 'ok' });
            expect(result.isValid).toBe(true);
            expect(result.issues).toHaveLength(0);
        });

        it('throws when validator is disabled', async () => {
            validator.enabled = false;
            await expect(validator.validate({ value: 'ok' })).rejects.toThrow('is disabled');
        });

        it('reports issues when validation fails', async () => {
            validator.shouldFailRule = true;
            const result = await validator.validate({ value: 'bad' }, { includeWarnings: true });
            expect(result.isValid).toBe(false);
            expect(result.issues.length).toBeGreaterThan(0);
        });

        it('handles rule execution errors', async () => {
            validator.shouldThrowRule = true;
            const result = await validator.validate({ value: 'ok' });
            expect(result.issues.some(i => i.message.includes('failed to execute'))).toBe(true);
        });

        it('updates stats after validation', async () => {
            await validator.validate({ value: 'ok' });
            const stats = validator.getStats();
            expect(stats.totalValidations).toBe(1);
            expect(stats.successfulValidations).toBe(1);
        });
    });

    describe('validateRule', () => {
        it('validates a single rule', async () => {
            const result = await validator.validateRule({ value: 'ok' }, 'rule-a');
            expect(result.isValid).toBe(true);
        });

        it('throws for unknown rule', async () => {
            await expect(validator.validateRule({ value: 'ok' }, 'unknown'))
                .rejects.toThrow('is not available');
        });

        it('reports issues for failing rule', async () => {
            validator.shouldFailRule = true;
            const result = await validator.validateRule({ value: 'bad' }, 'rule-a');
            expect(result.isValid).toBe(false);
        });
    });

    describe('canValidate', () => {
        it('returns true for valid data', () => {
            expect(validator.canValidate({ value: 'ok' })).toBe(true);
        });

        it('returns false for null', () => {
            expect(validator.canValidate(null as any)).toBe(false);
        });
    });

    describe('getRuleDescriptions', () => {
        it('returns descriptions for all rules', () => {
            const descs = validator.getRuleDescriptions();
            expect(descs.size).toBe(2);
            expect(descs.get('rule-a')?.description).toBe('Rule A');
        });
    });

    describe('configureRules', () => {
        it('enables/disables rules', async () => {
            validator.configureRules(new Map([['rule-a', false]]));
            const result = await validator.validate({ value: 'ok' });
            // rule-a is disabled, only rule-b runs
            expect(result.isValid).toBe(true);
        });
    });

    describe('autoRecover', () => {
        it('returns data unchanged with no recovery', async () => {
            const issues: IValidationIssue[] = [{ id: 'i1', severity: ValidationSeverity.ERROR, message: 'err', rule: 'r', detectedAt: new Date() }];
            const result = await validator.autoRecover({ value: 'bad' }, issues);
            expect(result.recoveryResult.success).toBe(false);
            expect(result.recoveredData.value).toBe('bad');
        });
    });

    describe('getStats and resetStats', () => {
        it('returns zero stats initially', () => {
            const stats = validator.getStats();
            expect(stats.totalValidations).toBe(0);
        });

        it('resets stats', async () => {
            await validator.validate({ value: 'ok' });
            validator.resetStats();
            expect(validator.getStats().totalValidations).toBe(0);
        });
    });
});
