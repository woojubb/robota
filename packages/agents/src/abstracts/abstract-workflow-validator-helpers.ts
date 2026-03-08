/**
 * Result creation, statistics, and data helpers for AbstractWorkflowValidator.
 *
 * Extracted from abstract-workflow-validator.ts to keep each file under 300 lines.
 * @internal
 */
import type { IValidationOptions, IValidationResult, IValidationIssue } from '../interfaces/workflow-validator';
import { ValidationSeverity } from '../interfaces/workflow-validator';
import type { IWorkflowData } from '../interfaces/workflow-converter';
import type { TUniversalValue } from '../interfaces/types';
import type { IValidatorStats, IValidationRuleConfig } from './abstract-workflow-validator';

const PREVIEW_LENGTH = 100;
const TOP_ISSUES_COUNT = 10;

/** @internal */
export function createValidationResultHelper(
    appliedRules: string[], startTime: number, data: IWorkflowData, options: IValidationOptions,
    issues: IValidationIssue[], validatorName: string, validatorVersion: string,
    getDataStats: (d: Record<string, string | number | boolean>) => Record<string, string | number | boolean>
): IValidationResult {
    const now = new Date(); const processingTime = now.getTime() - startTime;
    const summary = {
        errorCount: issues.filter(i => i.severity === ValidationSeverity.ERROR).length,
        warningCount: issues.filter(i => i.severity === ValidationSeverity.WARNING).length,
        infoCount: issues.filter(i => i.severity === ValidationSeverity.INFO).length,
        totalIssues: issues.length
    };
    return {
        isValid: summary.errorCount === 0 && (!options.strict || summary.warningCount === 0), issues, summary,
        metadata: { validatedAt: now, processingTime, validator: validatorName, rulesApplied: appliedRules, dataStats: getDataStats(extractSimpleData(data)), version: validatorVersion, options: extractSimpleOptions(options) }
    };
}

/** @internal */
export function createFailureResultHelper(
    error: Error, startTime: number, data: IWorkflowData, validatorName: string, validatorVersion: string,
    getDataStats: (d: Record<string, string | number | boolean>) => Record<string, string | number | boolean>
): IValidationResult {
    const now = new Date(); const processingTime = now.getTime() - startTime;
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
        isValid: false,
        issues: [{ id: 'validation-system-error', severity: ValidationSeverity.ERROR, message: 'Validation system encountered an error', details: errorMessage, rule: 'system', detectedAt: now }],
        summary: { errorCount: 1, warningCount: 0, infoCount: 0, totalIssues: 1 },
        metadata: { validatedAt: now, processingTime, validator: validatorName, rulesApplied: [], dataStats: getDataStats(extractSimpleData(data)), version: validatorVersion }
    };
}

/** @internal */
export function updateStatisticsHelper(stats: IValidatorStats, result: IValidationResult): void {
    if (result.isValid) stats.successfulValidations++; else stats.failedValidations++;
    stats.totalProcessingTime += result.metadata.processingTime;
    stats.totalIssueCount += result.summary.totalIssues;
    stats.lastValidationAt = result.metadata.validatedAt;
    for (const issue of result.issues) {
        stats.issuesByRule.set(issue.rule, (stats.issuesByRule.get(issue.rule) || 0) + 1);
        stats.issuesBySeverity.set(issue.severity, (stats.issuesBySeverity.get(issue.severity) || 0) + 1);
    }
}

/** @internal */
export function buildValidatorStatsOutput(stats: IValidatorStats, ruleConfigs: Map<string, IValidationRuleConfig>): {
    totalValidations: number; successfulValidations: number; failedValidations: number;
    averageProcessingTime: number; averageIssueCount: number;
    mostCommonIssues: Array<{ rule: string; count: number; severity: ValidationSeverity }>; lastValidationAt?: Date;
} {
    const mostCommonIssues = Array.from(stats.issuesByRule.entries()).sort(([, a], [, b]) => b - a).slice(0, TOP_ISSUES_COUNT)
        .map(([rule, count]) => ({ rule, count, severity: ruleConfigs.get(rule)?.severity || ValidationSeverity.ERROR }));
    return {
        totalValidations: stats.totalValidations, successfulValidations: stats.successfulValidations, failedValidations: stats.failedValidations,
        averageProcessingTime: stats.totalValidations > 0 ? stats.totalProcessingTime / stats.totalValidations : 0,
        averageIssueCount: stats.totalValidations > 0 ? stats.totalIssueCount / stats.totalValidations : 0,
        mostCommonIssues, lastValidationAt: stats.lastValidationAt
    };
}

/** @internal */
export function filterIssuesHelper(issues: IValidationIssue[], options: IValidationOptions): IValidationIssue[] {
    let filtered = [...issues];
    if (!options.includeWarnings) filtered = filtered.filter(i => i.severity !== ValidationSeverity.WARNING);
    if (!options.includeInfo) filtered = filtered.filter(i => i.severity !== ValidationSeverity.INFO);
    if (options.maxErrors && options.maxErrors > 0) {
        const errorCount = filtered.filter(i => i.severity === ValidationSeverity.ERROR).length;
        if (errorCount > options.maxErrors) {
            const errors = filtered.filter(i => i.severity === ValidationSeverity.ERROR).slice(0, options.maxErrors);
            const nonErrors = filtered.filter(i => i.severity !== ValidationSeverity.ERROR);
            filtered = [...errors, ...nonErrors];
        }
    }
    return filtered;
}

/** @internal */
export function getEnabledRulesHelper(
    availableRules: string[], ruleConfigs: Map<string, IValidationRuleConfig>, options: IValidationOptions
): string[] {
    let rules = availableRules.filter(r => { const c = ruleConfigs.get(r); return c?.enabled !== false; });
    if (options.skipRules) rules = rules.filter(r => !options.skipRules!.includes(r));
    if (options.includeRules) rules = rules.filter(r => options.includeRules!.includes(r));
    return rules;
}

/** @internal */
export function extractSimpleData(data: IWorkflowData): Record<string, string | number | boolean> {
    const result: Record<string, string | number | boolean> = {};
    if (data && typeof data === 'object') {
        const obj = data as Record<string, TUniversalValue>;
        const nodes = obj['nodes']; if (Array.isArray(nodes)) result.nodes = nodes.length;
        const edges = obj['edges']; if (Array.isArray(edges)) result.edges = edges.length;
        const node = obj['node']; if (Array.isArray(node)) result.node = node.length;
        const connections = obj['connections']; if (Array.isArray(connections)) result.connections = connections.length;
    }
    return result;
}

function extractSimpleOptions(options: IValidationOptions): string | number | boolean | string[] | Date {
    if (typeof options === 'object' && options !== null) return `${JSON.stringify(options).substring(0, PREVIEW_LENGTH)}...`;
    return String(options);
}
