/**
 * Abstract Workflow Converter
 *
 * Abstract base class for all workflow converters in the Robota SDK.
 * Uses an enabled flag + injected logger pattern.
 *
 * @template TInput - Input workflow data type
 * @template TOutput - Output workflow data type
 */

import type {
  IWorkflowConverter,
  IWorkflowConversionOptions,
  IWorkflowConversionResult,
  IWorkflowData,
  IWorkflowConfig,
} from '../interfaces/workflow-converter';
import type { ILogger } from '../utils/logger';
import { SilentLogger } from '../utils/logger';
import type { TUniversalValue } from '../interfaces/types';
import {
  getWorkflowDataStats,
  buildSuccessResult,
  buildFailureResult,
  defaultValidateInput,
  defaultValidateOutput,
} from './workflow-converter-helpers';

/**
 * Converter options (enabled flag + injected logger).
 */
export interface IBaseWorkflowConverterOptions {
  /** Enable/disable the converter */
  enabled?: boolean;

  /** Custom logger instance */
  logger?: ILogger;

  /** Converter-specific configuration */
  config?: IWorkflowConfig;
}

/**
 * Converter statistics tracking
 */
interface IConverterStats {
  totalConversions: number;
  successfulConversions: number;
  failedConversions: number;
  totalProcessingTime: number;
  lastConversionAt?: Date;
}

/**
 * Base Workflow Converter Abstract Class
 *
 * Provides common functionality for all workflow converters:
 * - Statistics tracking
 * - Logging with dependency injection
 * - Error handling and validation
 * - Performance monitoring
 * - Enable/disable functionality
 *
 * @template TInput - Input workflow data type
 * @template TOutput - Output workflow data type
 */
export abstract class AbstractWorkflowConverter<
  TInput extends IWorkflowData,
  TOutput extends IWorkflowData,
> implements IWorkflowConverter<TInput, TOutput>
{
  // Abstract properties that must be implemented by subclasses
  abstract readonly name: string;
  abstract readonly version: string;
  abstract readonly sourceFormat: string;
  abstract readonly targetFormat: string;

  /** Enable/disable state */
  public enabled: boolean;

  /** Logger instance with dependency injection */
  protected readonly logger: ILogger;

  /** Converter configuration */
  protected readonly config: IWorkflowConfig;

  /** Statistics tracking */
  private stats: IConverterStats = {
    totalConversions: 0,
    successfulConversions: 0,
    failedConversions: 0,
    totalProcessingTime: 0,
  };

  /**
   * Constructor
   *
   * @param options - Converter configuration options
   */
  constructor(options: IBaseWorkflowConverterOptions = {}) {
    this.enabled = options.enabled ?? true;
    this.logger = options.logger || SilentLogger;
    this.config = options.config || {};

    this.logger.debug(`${this.constructor.name} initialized`, {
      enabled: this.enabled,
    });
  }

  /**
   * Main conversion method with comprehensive error handling and metrics
   *
   * @param input - Input workflow data
   * @param options - Conversion options
   * @returns Promise resolving to conversion result
   */
  async convert(
    input: TInput,
    options: IWorkflowConversionOptions = {},
  ): Promise<IWorkflowConversionResult<TOutput>> {
    if (!this.enabled) {
      throw new Error(`Converter ${this.name} is disabled`);
    }

    const startTime = Date.now();
    const logger = options.logger || this.logger;

    logger.debug(`Starting conversion from ${this.sourceFormat} to ${this.targetFormat}`);

    try {
      // Update statistics
      this.stats.totalConversions++;

      // Validate input if requested
      if (options.validateInput) {
        const inputValidation = await this.validateInput(input);
        if (!inputValidation.isValid) {
          this.stats.failedConversions++;
          return this.createFailureResult(
            inputValidation.errors,
            inputValidation.warnings,
            startTime,
            input,
            logger,
          );
        }
      }

      // Perform the actual conversion (implemented by subclass)
      const convertedData = await this.performConversion(input, options);

      // Validate output if requested
      if (options.validateOutput) {
        const outputValidation = await this.validateOutput(convertedData);
        if (!outputValidation.isValid) {
          this.stats.failedConversions++;
          return this.createFailureResult(
            outputValidation.errors,
            outputValidation.warnings,
            startTime,
            input,
            logger,
          );
        }
      }

      // Create success result
      const result = this.createSuccessResult(convertedData, startTime, input, options);

      // Update statistics
      this.stats.successfulConversions++;
      this.stats.totalProcessingTime += result.metadata.processingTime;
      this.stats.lastConversionAt = result.metadata.convertedAt;

      logger.debug(`Conversion completed successfully`, {
        processingTime: result.metadata.processingTime,
        inputNodes: result.metadata.inputStats.nodeCount,
        outputNodes: result.metadata.outputStats.nodeCount,
      });

      return result;
    } catch (error) {
      this.stats.failedConversions++;
      const processingTime = Date.now() - startTime;

      logger.error(`Conversion failed`, {
        error: error instanceof Error ? error.message : String(error),
        processingTime,
      });

      return this.createFailureResult(
        [error instanceof Error ? error.message : String(error)],
        [],
        startTime,
        input,
        logger,
      );
    }
  }

  /**
   * Abstract method for actual conversion logic
   * Must be implemented by subclasses
   *
   * @param input - Input workflow data
   * @param options - Conversion options
   * @returns Promise resolving to converted data
   */
  protected abstract performConversion(
    input: TInput,
    options: IWorkflowConversionOptions,
  ): Promise<TOutput>;

  /**
   * Default input validation (can be overridden by subclasses)
   */
  async validateInput(
    input: TInput,
  ): Promise<{ isValid: boolean; errors: string[]; warnings: string[] }> {
    return defaultValidateInput(input);
  }

  /**
   * Default output validation (can be overridden by subclasses)
   */
  async validateOutput(
    output: TOutput,
  ): Promise<{ isValid: boolean; errors: string[]; warnings: string[] }> {
    return defaultValidateOutput(output);
  }

  /** Check if converter can handle this input. Override for specific type checking. */
  canConvert(input: IWorkflowData): input is TInput {
    return input != null;
  }

  /** Get converter statistics. */
  getStats() {
    return {
      totalConversions: this.stats.totalConversions,
      successfulConversions: this.stats.successfulConversions,
      failedConversions: this.stats.failedConversions,
      averageProcessingTime:
        this.stats.totalConversions > 0
          ? this.stats.totalProcessingTime / this.stats.totalConversions
          : 0,
      lastConversionAt: this.stats.lastConversionAt,
    };
  }

  /**
   * Reset converter statistics
   */
  resetStats(): void {
    this.stats = {
      totalConversions: 0,
      successfulConversions: 0,
      failedConversions: 0,
      totalProcessingTime: 0,
    };

    this.logger.debug(`Statistics reset for converter ${this.name}`);
  }

  /**
   * Create success result with metadata.
   * Can be overridden if subclasses need a different shape.
   */
  protected createSuccessResult(
    data: TOutput,
    startTime: number,
    input: TInput,
    options: IWorkflowConversionOptions,
  ): IWorkflowConversionResult<TOutput> {
    return buildSuccessResult(data, startTime, input, options, this.name, this.version, (d) =>
      this.getDataStats(d),
    );
  }

  /**
   * Create failure result with error information.
   */
  protected createFailureResult(
    errors: string[],
    warnings: string[],
    startTime: number,
    input: TInput,
    logger: ILogger,
  ): IWorkflowConversionResult<TOutput> {
    return buildFailureResult(
      errors,
      warnings,
      startTime,
      input,
      logger,
      this.name,
      this.version,
      (d) => this.getDataStats(d),
    );
  }

  /**
   * Extract basic statistics from workflow data.
   * Can be overridden by subclasses for specific data formats.
   */
  protected getDataStats(data: Record<string, TUniversalValue>): {
    nodeCount: number;
    edgeCount: number;
  } {
    return getWorkflowDataStats(data);
  }
}
