/**
 * Abstract Workflow Validator
 *
 * Abstract base class for all workflow validators in the Robota SDK.
 * Result creation, statistics, and data helpers live in ./abstract-workflow-validator-helpers.ts.
 *
 * @template TWorkflowData - Type of workflow data to validate
 */
import {
  IWorkflowValidator,
  IValidationOptions,
  IValidationResult,
  IValidationIssue,
  ValidationSeverity,
} from '../interfaces/workflow-validator';
import type { IWorkflowData, IWorkflowConfig } from '../interfaces/workflow-converter';
import type { ILogger } from '../utils/logger';
import { SilentLogger } from '../utils/logger';
import {
  createValidationResultHelper,
  createFailureResultHelper,
  updateStatisticsHelper,
  buildValidatorStatsOutput,
  filterIssuesHelper,
  getEnabledRulesHelper,
} from './abstract-workflow-validator-helpers';

/** Validator options (enabled flag + injected logger). */
export interface IBaseWorkflowValidatorOptions {
  enabled?: boolean;
  logger?: ILogger;
  config?: IWorkflowConfig;
  defaultOptions?: Partial<IValidationOptions>;
}

export interface IValidatorStats {
  totalValidations: number;
  successfulValidations: number;
  failedValidations: number;
  totalProcessingTime: number;
  totalIssueCount: number;
  issuesByRule: Map<string, number>;
  issuesBySeverity: Map<ValidationSeverity, number>;
  lastValidationAt?: Date;
}

export interface IValidationRuleConfig {
  enabled: boolean;
  description: string;
  severity: ValidationSeverity;
  category: string;
}

/**
 * Base Workflow Validator Abstract Class.
 * Provides statistics tracking, logging with DI, rule management, and performance monitoring.
 * @template TWorkflowData - Type of workflow data to validate
 */
export abstract class AbstractWorkflowValidator<TWorkflowData extends IWorkflowData>
  implements IWorkflowValidator<TWorkflowData>
{
  abstract readonly name: string;
  abstract readonly version: string;
  abstract readonly dataFormat: string;
  abstract readonly availableRules: string[];
  public enabled: boolean;
  protected readonly logger: ILogger;
  protected readonly config: IWorkflowConfig;
  protected readonly defaultOptions: Partial<IValidationOptions>;
  protected readonly ruleConfigs: Map<string, IValidationRuleConfig> = new Map();
  private stats: IValidatorStats = {
    totalValidations: 0,
    successfulValidations: 0,
    failedValidations: 0,
    totalProcessingTime: 0,
    totalIssueCount: 0,
    issuesByRule: new Map(),
    issuesBySeverity: new Map(),
  };

  constructor(options: IBaseWorkflowValidatorOptions = {}) {
    this.enabled = options.enabled ?? true;
    this.logger = options.logger || SilentLogger;
    this.config = options.config || {};
    this.defaultOptions = options.defaultOptions || {};
    this.initializeRuleConfigs();
    this.logger.debug(`${this.constructor.name} initialized`, { enabled: this.enabled });
  }

  async validate(
    data: TWorkflowData,
    options: IValidationOptions = {},
  ): Promise<IValidationResult> {
    if (!this.enabled) throw new Error(`Validator ${this.name} is disabled`);
    const startTime = Date.now();
    const merged = { ...this.defaultOptions, ...options };
    const logger = merged.logger || this.logger;
    logger.debug(`Starting validation with ${this.name}`, {
      strict: merged.strict,
      rulesCount: this.availableRules.length,
    });
    try {
      this.stats.totalValidations++;
      const enabledRules = getEnabledRulesHelper(this.availableRules, this.ruleConfigs, merged);
      if (enabledRules.length === 0) logger.warn('No validation rules enabled');
      const allIssues: IValidationIssue[] = [];
      for (const rule of enabledRules) {
        try {
          const rr = await this.performRuleValidation(data, rule, merged);
          allIssues.push(...rr.issues);
        } catch (error) {
          logger.error(`Rule ${rule} failed to execute`, {
            error: error instanceof Error ? error.message : String(error),
          });
          allIssues.push({
            id: `rule-execution-error-${rule}`,
            severity: ValidationSeverity.ERROR,
            message: `Validation rule '${rule}' failed to execute`,
            details: error instanceof Error ? error.message : String(error),
            rule,
            detectedAt: new Date(),
          });
        }
      }
      const filteredIssues = filterIssuesHelper(allIssues, merged);
      const result = createValidationResultHelper(
        enabledRules,
        startTime,
        data,
        merged,
        filteredIssues,
        this.name,
        this.version,
        (d) => this.getDataStats(d),
      );
      updateStatisticsHelper(this.stats, result);
      logger.debug('Validation completed', {
        processingTime: result.metadata.processingTime,
        issueCount: result.summary.totalIssues,
        isValid: result.isValid,
      });
      return result;
    } catch (error) {
      this.stats.failedValidations++;
      logger.error('Validation failed', {
        error: error instanceof Error ? error.message : String(error),
        processingTime: Date.now() - startTime,
      });
      return createFailureResultHelper(
        error instanceof Error ? error : new Error(String(error)),
        startTime,
        data,
        this.name,
        this.version,
        (d) => this.getDataStats(d),
      );
    }
  }

  async validateRule(
    data: TWorkflowData,
    rule: string,
    options: IValidationOptions = {},
  ): Promise<IValidationResult> {
    if (!this.availableRules.includes(rule))
      throw new Error(`Rule '${rule}' is not available in validator ${this.name}`);
    const startTime = Date.now();
    const merged = { ...this.defaultOptions, ...options };
    try {
      const rr = await this.performRuleValidation(data, rule, merged);
      return createValidationResultHelper(
        [rule],
        startTime,
        data,
        merged,
        rr.issues,
        this.name,
        this.version,
        (d) => this.getDataStats(d),
      );
    } catch (error) {
      return createFailureResultHelper(
        error instanceof Error ? error : new Error(String(error)),
        startTime,
        data,
        this.name,
        this.version,
        (d) => this.getDataStats(d),
      );
    }
  }

  protected abstract performRuleValidation(
    data: TWorkflowData,
    rule: string,
    options: IValidationOptions,
  ): Promise<{ issues: IValidationIssue[] }>;
  protected abstract initializeRuleConfigs(): void;
  canValidate(data: TWorkflowData): data is TWorkflowData {
    return data != null;
  }

  getRuleDescriptions(): Map<
    string,
    { description: string; severity: ValidationSeverity; category: string; enabled: boolean }
  > {
    const descriptions = new Map<
      string,
      { description: string; severity: ValidationSeverity; category: string; enabled: boolean }
    >();
    for (const rule of this.availableRules) {
      const c = this.ruleConfigs.get(rule);
      if (c)
        descriptions.set(rule, {
          description: c.description,
          severity: c.severity,
          category: c.category,
          enabled: c.enabled,
        });
    }
    return descriptions;
  }

  configureRules(rules: Map<string, boolean>): void {
    for (const [rule, enabled] of rules) {
      const c = this.ruleConfigs.get(rule);
      if (c) {
        c.enabled = enabled;
        this.logger.debug(`Rule ${rule} ${enabled ? 'enabled' : 'disabled'}`);
      } else this.logger.warn(`Attempted to configure unknown rule: ${rule}`);
    }
  }

  async autoRecover(
    data: TWorkflowData,
    issues: IValidationIssue[],
  ): Promise<{
    recoveredData: TWorkflowData;
    recoveryResult: {
      success: boolean;
      issuesFixed: IValidationIssue[];
      remainingIssues: IValidationIssue[];
      appliedFixes: string[];
    };
  }> {
    return {
      recoveredData: data,
      recoveryResult: {
        success: false,
        issuesFixed: [],
        remainingIssues: issues,
        appliedFixes: [],
      },
    };
  }

  getStats() {
    return buildValidatorStatsOutput(this.stats, this.ruleConfigs);
  }

  resetStats(): void {
    this.stats = {
      totalValidations: 0,
      successfulValidations: 0,
      failedValidations: 0,
      totalProcessingTime: 0,
      totalIssueCount: 0,
      issuesByRule: new Map(),
      issuesBySeverity: new Map(),
    };
    this.logger.debug(`Statistics reset for validator ${this.name}`);
  }

  protected getDataStats(
    data: Record<string, string | number | boolean>,
  ): Record<string, string | number | boolean> {
    if (!data) return { nodeCount: 0, edgeCount: 0 };
    const nodeCount = Array.isArray(data.nodes)
      ? data.nodes.length
      : Array.isArray(data.node)
        ? data.node.length
        : 0;
    const edgeCount = Array.isArray(data.edges)
      ? data.edges.length
      : Array.isArray(data.connections)
        ? data.connections.length
        : Array.isArray(data.edge)
          ? data.edge.length
          : 0;
    return { nodeCount, edgeCount };
  }
}
