/**
 * Base Workflow Validator
 * 
 * Abstract base class for all workflow validators in the Robota SDK.
 * Follows BaseModule pattern with enabled state, logger, and event emission.
 * 
 * @template TWorkflowData - Type of workflow data to validate
 */

import {
    WorkflowValidatorInterface,
    ValidationOptions,
    ValidationResult,
    ValidationIssue,
    ValidationSeverity
} from '../interfaces/workflow-validator';
import type { WorkflowData, WorkflowConfig } from '../interfaces/workflow-converter';
import type { AbstractLogger } from '../utils/abstract-logger';
import { DEFAULT_ABSTRACT_LOGGER } from '../utils/abstract-logger';

/**
 * Base validator options following BaseModule pattern
 */
export interface BaseWorkflowValidatorOptions {
    /** Enable/disable the validator */
    enabled?: boolean;

    /** Custom logger instance */
    logger?: AbstractLogger;

    /** Validator-specific configuration */
    config?: WorkflowConfig;

    /** Default validation options */
    defaultOptions?: Partial<ValidationOptions>;
}

/**
 * Validator statistics tracking
 */
interface ValidatorStats {
    totalValidations: number;
    successfulValidations: number;
    failedValidations: number;
    totalProcessingTime: number;
    totalIssueCount: number;
    issuesByRule: Map<string, number>;
    issuesBySeverity: Map<ValidationSeverity, number>;
    lastValidationAt?: Date;
}

/**
 * Validation rule configuration
 */
interface ValidationRuleConfig {
    enabled: boolean;
    description: string;
    severity: ValidationSeverity;
    category: string;
}

/**
 * Base Workflow Validator Abstract Class
 * 
 * Provides common functionality for all workflow validators:
 * - Statistics tracking
 * - Logging with dependency injection
 * - Rule management and configuration
 * - Performance monitoring
 * - Enable/disable functionality
 * - Common validation utilities
 * 
 * @template TWorkflowData - Type of workflow data to validate
 */
export abstract class AbstractWorkflowValidator<TWorkflowData extends WorkflowData>
    implements WorkflowValidatorInterface<TWorkflowData> {

    // Abstract properties that must be implemented by subclasses
    abstract readonly name: string;
    abstract readonly version: string;
    abstract readonly dataFormat: string;
    abstract readonly availableRules: string[];

    /** Enable/disable state following BaseModule pattern */
    public enabled: boolean;

    /** Logger instance with dependency injection */
    protected readonly logger: AbstractLogger;

    /** Validator configuration */
    protected readonly config: WorkflowConfig;

    /** Default validation options */
    protected readonly defaultOptions: Partial<ValidationOptions>;

    /** Rule configurations */
    protected readonly ruleConfigs: Map<string, ValidationRuleConfig> = new Map();

    /** Statistics tracking */
    private stats: ValidatorStats = {
        totalValidations: 0,
        successfulValidations: 0,
        failedValidations: 0,
        totalProcessingTime: 0,
        totalIssueCount: 0,
        issuesByRule: new Map(),
        issuesBySeverity: new Map()
    };

    /**
     * Constructor following BaseModule pattern
     * 
     * @param options - Validator configuration options
     */
    constructor(options: BaseWorkflowValidatorOptions = {}) {
        this.enabled = options.enabled ?? true;
        this.logger = options.logger || DEFAULT_ABSTRACT_LOGGER;
        this.config = options.config || {};
        this.defaultOptions = options.defaultOptions || {};

        // Initialize rule configurations
        this.initializeRuleConfigs();

        this.logger.debug(`${this.constructor.name} initialized`, {
            enabled: this.enabled
        });
    }

    /**
     * Main validation method with comprehensive error handling and metrics
     * 
     * @param data - Workflow data to validate
     * @param options - Validation options
     * @returns Promise resolving to validation result
     */
    async validate(data: TWorkflowData, options: ValidationOptions = {}): Promise<ValidationResult> {
        if (!this.enabled) {
            throw new Error(`Validator ${this.name} is disabled`);
        }

        const startTime = Date.now();
        const mergedOptions = { ...this.defaultOptions, ...options };
        const logger = mergedOptions.logger || this.logger;

        logger.debug(`Starting validation with ${this.name}`, {
            strict: mergedOptions.strict,
            rulesCount: this.availableRules.length
        });

        try {
            // Update statistics
            this.stats.totalValidations++;

            // Get enabled rules
            const enabledRules = this.getEnabledRules(mergedOptions);

            if (enabledRules.length === 0) {
                logger.warn('No validation rules enabled');
            }

            // Collect all validation issues
            const allIssues: ValidationIssue[] = [];

            // Run validation rules
            for (const rule of enabledRules) {
                try {
                    const ruleResult = await this.performRuleValidation(data, rule, mergedOptions);
                    allIssues.push(...ruleResult.issues);
                } catch (error) {
                    logger.error(`Rule ${rule} failed to execute`, {
                        error: error instanceof Error ? error.message : String(error)
                    });

                    allIssues.push({
                        id: `rule-execution-error-${rule}`,
                        severity: ValidationSeverity.ERROR,
                        message: `Validation rule '${rule}' failed to execute`,
                        details: error instanceof Error ? error.message : String(error),
                        rule,
                        detectedAt: new Date()
                    });
                }
            }

            // Filter issues based on options
            const filteredIssues = this.filterIssues(allIssues, mergedOptions);

            // Create validation result
            const result = this.createValidationResult(
                enabledRules,
                startTime,
                data,
                mergedOptions,
                filteredIssues
            );

            // Update statistics
            this.updateStatistics(result);

            logger.debug(`Validation completed`, {
                processingTime: result.metadata.processingTime,
                issueCount: result.summary.totalIssues,
                isValid: result.isValid
            });

            return result;

        } catch (error) {
            this.stats.failedValidations++;
            const processingTime = Date.now() - startTime;

            logger.error(`Validation failed`, {
                error: error instanceof Error ? error.message : String(error),
                processingTime
            });

            return this.createFailureResult(error instanceof Error ? error : new Error(String(error)), startTime, data);
        }
    }

    /**
     * Validate specific rule
     * 
     * @param data - Workflow data to validate
     * @param rule - Specific rule to apply
     * @param options - Validation options
     * @returns Promise resolving to validation result for this rule
     */
    async validateRule(
        data: TWorkflowData,
        rule: string,
        options: ValidationOptions = {}
    ): Promise<ValidationResult> {
        if (!this.availableRules.includes(rule)) {
            throw new Error(`Rule '${rule}' is not available in validator ${this.name}`);
        }

        const startTime = Date.now();
        const mergedOptions = { ...this.defaultOptions, ...options };

        try {
            const ruleResult = await this.performRuleValidation(data, rule, mergedOptions);
            return this.createValidationResult([rule], startTime, data, mergedOptions, ruleResult.issues);
        } catch (error) {
            return this.createFailureResult(error instanceof Error ? error : new Error(String(error)), startTime, data);
        }
    }

    /**
     * Abstract method for performing individual rule validation
     * Must be implemented by subclasses
     * 
     * @param data - Workflow data to validate
     * @param rule - Rule to validate
     * @param options - Validation options
     * @returns Promise resolving to rule validation result
     */
    protected abstract performRuleValidation(
        data: TWorkflowData,
        rule: string,
        options: ValidationOptions
    ): Promise<{ issues: ValidationIssue[] }>;

    /**
     * Abstract method for initializing rule configurations
     * Must be implemented by subclasses
     */
    protected abstract initializeRuleConfigs(): void;

    /**
     * Default implementation for checking if validator can handle data
     * Should be overridden by subclasses for specific type checking
     * 
     * @param data - Data to check
     * @returns True if validator can handle this data
     */
    canValidate(data: WorkflowData): data is TWorkflowData {
        // Basic existence check - subclasses should provide more specific logic
        return data != null;
    }

    /**
     * Get available validation rules with descriptions
     * 
     * @returns Map of rule names to descriptions
     */
    getRuleDescriptions(): Map<string, {
        description: string;
        severity: ValidationSeverity;
        category: string;
        enabled: boolean;
    }> {
        const descriptions = new Map();

        for (const rule of this.availableRules) {
            const config = this.ruleConfigs.get(rule);
            if (config) {
                descriptions.set(rule, {
                    description: config.description,
                    severity: config.severity,
                    category: config.category,
                    enabled: config.enabled
                });
            }
        }

        return descriptions;
    }

    /**
     * Enable or disable specific validation rules
     * 
     * @param rules - Map of rule names to enabled status
     */
    configureRules(rules: Map<string, boolean>): void {
        for (const [rule, enabled] of rules) {
            const config = this.ruleConfigs.get(rule);
            if (config) {
                config.enabled = enabled;
                this.logger.debug(`Rule ${rule} ${enabled ? 'enabled' : 'disabled'}`);
            } else {
                this.logger.warn(`Attempted to configure unknown rule: ${rule}`);
            }
        }
    }

    /**
     * Default auto-recovery implementation
     * Can be overridden by subclasses for specific recovery strategies
     * 
     * @param data - Original workflow data
     * @param issues - Validation issues to recover from
     * @returns Promise resolving to recovered data and recovery result
     */
    async autoRecover(data: TWorkflowData, issues: ValidationIssue[]): Promise<{
        recoveredData: TWorkflowData;
        recoveryResult: {
            success: boolean;
            issuesFixed: ValidationIssue[];
            remainingIssues: ValidationIssue[];
            appliedFixes: string[];
        };
    }> {
        // Default implementation returns original data with no fixes
        // Subclasses should override for specific recovery logic
        return {
            recoveredData: data,
            recoveryResult: {
                success: false,
                issuesFixed: [],
                remainingIssues: issues,
                appliedFixes: []
            }
        };
    }

    /**
     * Get validator statistics
     * 
     * @returns Validator performance metrics
     */
    getStats() {
        const mostCommonIssues = Array.from(this.stats.issuesByRule.entries())
            .sort(([, a], [, b]) => b - a)
            .slice(0, 10)
            .map(([rule, count]) => {
                const config = this.ruleConfigs.get(rule);
                return {
                    rule,
                    count,
                    severity: config?.severity || ValidationSeverity.ERROR
                };
            });

        return {
            totalValidations: this.stats.totalValidations,
            successfulValidations: this.stats.successfulValidations,
            failedValidations: this.stats.failedValidations,
            averageProcessingTime: this.stats.totalValidations > 0
                ? this.stats.totalProcessingTime / this.stats.totalValidations
                : 0,
            averageIssueCount: this.stats.totalValidations > 0
                ? this.stats.totalIssueCount / this.stats.totalValidations
                : 0,
            mostCommonIssues,
            lastValidationAt: this.stats.lastValidationAt
        };
    }

    /**
     * Reset validator statistics
     */
    resetStats(): void {
        this.stats = {
            totalValidations: 0,
            successfulValidations: 0,
            failedValidations: 0,
            totalProcessingTime: 0,
            totalIssueCount: 0,
            issuesByRule: new Map(),
            issuesBySeverity: new Map()
        };

        this.logger.debug(`Statistics reset for validator ${this.name}`);
    }

    /**
     * Get enabled rules based on options
     */
    private getEnabledRules(options: ValidationOptions): string[] {
        let rules = this.availableRules.filter(rule => {
            const config = this.ruleConfigs.get(rule);
            return config?.enabled !== false;
        });

        if (options.skipRules) {
            rules = rules.filter(rule => !options.skipRules!.includes(rule));
        }

        if (options.includeRules) {
            rules = rules.filter(rule => options.includeRules!.includes(rule));
        }

        return rules;
    }

    /**
     * Filter issues based on validation options
     */
    private filterIssues(issues: ValidationIssue[], options: ValidationOptions): ValidationIssue[] {
        let filteredIssues = [...issues];

        // Filter by severity
        if (!options.includeWarnings) {
            filteredIssues = filteredIssues.filter(issue => issue.severity !== ValidationSeverity.WARNING);
        }

        if (!options.includeInfo) {
            filteredIssues = filteredIssues.filter(issue => issue.severity !== ValidationSeverity.INFO);
        }

        // Limit number of errors
        if (options.maxErrors && options.maxErrors > 0) {
            const errorCount = filteredIssues.filter(issue => issue.severity === ValidationSeverity.ERROR).length;
            if (errorCount > options.maxErrors) {
                const errors = filteredIssues.filter(issue => issue.severity === ValidationSeverity.ERROR)
                    .slice(0, options.maxErrors);
                const nonErrors = filteredIssues.filter(issue => issue.severity !== ValidationSeverity.ERROR);
                filteredIssues = [...errors, ...nonErrors];
            }
        }

        return filteredIssues;
    }

    /**
     * Create validation result with metadata
     */
    private createValidationResult(
        appliedRules: string[],
        startTime: number,
        data: TWorkflowData,
        options: ValidationOptions,
        issues: ValidationIssue[] = []
    ): ValidationResult {
        const now = new Date();
        const processingTime = now.getTime() - startTime;

        const summary = {
            errorCount: issues.filter(i => i.severity === ValidationSeverity.ERROR).length,
            warningCount: issues.filter(i => i.severity === ValidationSeverity.WARNING).length,
            infoCount: issues.filter(i => i.severity === ValidationSeverity.INFO).length,
            totalIssues: issues.length
        };

        return {
            isValid: summary.errorCount === 0 && (!options.strict || summary.warningCount === 0),
            issues,
            summary,
            metadata: {
                validatedAt: now,
                processingTime,
                validator: this.name,
                rulesApplied: appliedRules,
                dataStats: this.getDataStats(this.extractSimpleData(data)),
                version: this.version,
                options: this.extractSimpleOptions(options)
            }
        };
    }

    /**
     * Create failure result for validation errors
     */
    private createFailureResult(
        error: Error,
        startTime: number,
        data: TWorkflowData
    ): ValidationResult {
        const now = new Date();
        const processingTime = now.getTime() - startTime;
        const errorMessage = error instanceof Error ? error.message : String(error);

        return {
            isValid: false,
            issues: [{
                id: 'validation-system-error',
                severity: ValidationSeverity.ERROR,
                message: 'Validation system encountered an error',
                details: errorMessage,
                rule: 'system',
                detectedAt: now
            }],
            summary: {
                errorCount: 1,
                warningCount: 0,
                infoCount: 0,
                totalIssues: 1
            },
            metadata: {
                validatedAt: now,
                processingTime,
                validator: this.name,
                rulesApplied: [],
                dataStats: this.getDataStats(this.extractSimpleData(data)),
                version: this.version
            }
        };
    }

    /**
     * Update statistics based on validation result
     */
    private updateStatistics(result: ValidationResult): void {
        if (result.isValid) {
            this.stats.successfulValidations++;
        } else {
            this.stats.failedValidations++;
        }

        this.stats.totalProcessingTime += result.metadata.processingTime;
        this.stats.totalIssueCount += result.summary.totalIssues;
        this.stats.lastValidationAt = result.metadata.validatedAt;

        // Update issue statistics
        for (const issue of result.issues) {
            // By rule
            const ruleCount = this.stats.issuesByRule.get(issue.rule) || 0;
            this.stats.issuesByRule.set(issue.rule, ruleCount + 1);

            // By severity
            const severityCount = this.stats.issuesBySeverity.get(issue.severity) || 0;
            this.stats.issuesBySeverity.set(issue.severity, severityCount + 1);
        }
    }

    /**
     * Extract simple options representation for metadata
     */
    private extractSimpleOptions(options: ValidationOptions): string | number | boolean | string[] | Date {
        // Convert ValidationOptions to simple type safely
        if (typeof options === 'object' && options !== null) {
            return `${JSON.stringify(options).substring(0, 100)}...`; // Truncated string representation
        }
        return String(options);
    }

    /**
     * Extract simple data representation from workflow data for statistics
     */
    private extractSimpleData(data: TWorkflowData): Record<string, string | number | boolean> {
        // Convert TWorkflowData to simple Record format safely
        const result: Record<string, string | number | boolean> = {};

        // Handle known workflow properties
        if (data && typeof data === 'object') {
            const dataObj = data as any;
            if (Array.isArray(dataObj.nodes)) {
                result.nodes = dataObj.nodes.length;
            }
            if (Array.isArray(dataObj.edges)) {
                result.edges = dataObj.edges.length;
            }
            if (Array.isArray(dataObj.node)) {
                result.node = dataObj.node.length;
            }
            if (Array.isArray(dataObj.connections)) {
                result.connections = dataObj.connections.length;
            }
        }

        return result;
    }

    /**
     * Extract basic statistics from workflow data
     * Can be overridden by subclasses for specific data formats
     */
    protected getDataStats(data: Record<string, string | number | boolean>): Record<string, string | number | boolean> {
        if (!data) {
            return { nodeCount: 0, edgeCount: 0 };
        }

        // Try to extract node and edge counts from common properties
        const nodeCount = Array.isArray(data.nodes) ? data.nodes.length :
            Array.isArray(data.node) ? data.node.length : 0;

        const edgeCount = Array.isArray(data.edges) ? data.edges.length :
            Array.isArray(data.connections) ? data.connections.length :
                Array.isArray(data.edge) ? data.edge.length : 0;

        return { nodeCount, edgeCount };
    }
}