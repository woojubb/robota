/**
 * Workflow Validator Interface
 * 
 * Defines the contract for workflow validation systems in the Robota SDK.
 * Follows Single Responsibility Principle by focusing only on validation logic.
 */

import { SimpleLogger } from '../utils/simple-logger';
import { WorkflowData, WorkflowConfig, WorkflowMetadata } from './workflow-converter';

/**
 * Validation severity levels
 */
export enum ValidationSeverity {
    ERROR = 'error',
    WARNING = 'warning',
    INFO = 'info'
}

/**
 * Individual validation issue
 */
export interface ValidationIssue {
    /** Unique identifier for this issue */
    id: string;

    /** Issue severity level */
    severity: ValidationSeverity;

    /** Human-readable message */
    message: string;

    /** Technical details or suggestion */
    details?: string;

    /** Location where issue was found */
    location?: {
        nodeId?: string;
        edgeId?: string;
        field?: string;
        line?: number;
        column?: number;
    };

    /** Rule that triggered this issue */
    rule: string;

    /** Suggested fix (if available) */
    suggestedFix?: {
        description: string;
        action: 'modify' | 'remove' | 'add';
        target?: WorkflowConfig;
    };

    /** Timestamp when issue was detected */
    detectedAt: Date;
}

/**
 * Validation options
 */
export interface ValidationOptions {
    /** Validation strictness level */
    strict?: boolean;

    /** Skip specific validation rules */
    skipRules?: string[];

    /** Include only specific validation rules */
    includeRules?: string[];

    /** Maximum number of errors to collect */
    maxErrors?: number;

    /** Include warnings in results */
    includeWarnings?: boolean;

    /** Include info messages in results */
    includeInfo?: boolean;

    /** Custom logger for validation process */
    logger?: SimpleLogger;

    /** Additional validation context */
    context?: WorkflowMetadata;

    /** Enable auto-recovery suggestions */
    enableAutoRecovery?: boolean;
}

/**
 * Validation result
 */
export interface ValidationResult {
    /** Overall validation success status */
    isValid: boolean;

    /** All validation issues found */
    issues: ValidationIssue[];

    /** Summary by severity */
    summary: {
        errorCount: number;
        warningCount: number;
        infoCount: number;
        totalIssues: number;
    };

    /** Validation metadata */
    metadata: {
        /** Validation timestamp */
        validatedAt: Date;

        /** Processing time in milliseconds */
        processingTime: number;

        /** Validator used */
        validator: string;

        /** Validation rules applied */
        rulesApplied: string[];

        /** Data statistics */
        dataStats: {
            nodeCount?: number;
            edgeCount?: number;
                        [key: string]: string | number | boolean;
        };
        
        /** Additional metrics */
        [key: string]: string | number | boolean;
    };

    /** Auto-recovery suggestions (if enabled) */
    recoveryOptions?: Array<{
        description: string;
        confidence: number; // 0-1
        action: () => Promise<WorkflowConfig>;
    }>;
}

/**
 * Workflow Validator Interface
 * 
 * Core interface for validating workflow data structures.
 * All workflow validators must implement this interface.
 * 
 * @template TWorkflowData - Type of workflow data to validate
 */
export interface WorkflowValidatorInterface<TWorkflowData extends WorkflowData> {
    /** Validator name for identification */
    readonly name: string;

    /** Validator version */
    readonly version: string;

    /** Data format that this validator handles */
    readonly dataFormat: string;

    /** Available validation rules */
    readonly availableRules: string[];

    /**
     * Validate workflow data
     * 
     * @param data - Workflow data to validate
     * @param options - Validation options
     * @returns Promise resolving to validation result
     */
    validate(data: TWorkflowData, options?: ValidationOptions): Promise<ValidationResult>;

    /**
     * Validate specific aspect of workflow data
     * 
     * @param data - Workflow data to validate
     * @param rule - Specific rule to apply
     * @param options - Validation options
     * @returns Promise resolving to validation result for this rule
     */
    validateRule(data: TWorkflowData, rule: string, options?: ValidationOptions): Promise<ValidationResult>;

    /**
     * Check if validator can handle the given data format
     * 
     * @param data - Data to check
     * @returns True if validator can handle this data
     */
    canValidate(data: WorkflowData): data is TWorkflowData;

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
    }>;

    /**
     * Enable or disable specific validation rules
     * 
     * @param rules - Map of rule names to enabled status
     */
    configureRules(rules: Map<string, boolean>): void;

    /**
     * Perform automatic recovery for validation issues
     * 
     * @param data - Original workflow data
     * @param issues - Validation issues to recover from
     * @returns Promise resolving to recovered data and recovery result
     */
    autoRecover(data: TWorkflowData, issues: ValidationIssue[]): Promise<{
        recoveredData: TWorkflowData;
        recoveryResult: {
            success: boolean;
            issuesFixed: ValidationIssue[];
            remainingIssues: ValidationIssue[];
            appliedFixes: string[];
        };
    }>;

    /**
     * Get validator statistics and metrics
     * 
     * @returns Validator performance metrics
     */
    getStats(): {
        totalValidations: number;
        successfulValidations: number;
        failedValidations: number;
        averageProcessingTime: number;
        averageIssueCount: number;
        mostCommonIssues: Array<{
            rule: string;
            count: number;
            severity: ValidationSeverity;
        }>;
        lastValidationAt?: Date;
    };

    /**
     * Reset validator statistics
     */
    resetStats(): void;
}