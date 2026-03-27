/**
 * Helper functions for AbstractWorkflowConverter.
 *
 * Extracted from abstracts/abstract-workflow-converter.ts to keep that file under 300 lines.
 * Contains result construction, stats extraction, and default validation logic.
 */
import type {
  IWorkflowConversionOptions,
  IWorkflowConversionResult,
  IWorkflowData,
} from '../interfaces/workflow-converter';
import type { ILogger } from '../utils/logger';
import type { TUniversalValue } from '../interfaces/types';

/**
 * Extract basic node/edge statistics from workflow data.
 * Falls back to 0 when properties are missing or not arrays.
 */
export function getWorkflowDataStats(data: Record<string, TUniversalValue>): {
  nodeCount: number;
  edgeCount: number;
} {
  if (!data) {
    return { nodeCount: 0, edgeCount: 0 };
  }

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

/**
 * Build a successful IWorkflowConversionResult.
 */
export function buildSuccessResult<TInput extends IWorkflowData, TOutput extends IWorkflowData>(
  data: TOutput,
  startTime: number,
  input: TInput,
  options: IWorkflowConversionOptions,
  converterName: string,
  converterVersion: string,
  getStatsFn: (d: Record<string, TUniversalValue>) => { nodeCount: number; edgeCount: number },
): IWorkflowConversionResult<TOutput> {
  const now = new Date();
  const processingTime = now.getTime() - startTime;
  return {
    data,
    success: true,
    errors: [],
    warnings: [],
    metadata: {
      convertedAt: now,
      processingTime,
      inputStats: getStatsFn(input as Record<string, TUniversalValue>),
      outputStats: getStatsFn(data as Record<string, TUniversalValue>),
      converter: converterName,
      version: converterVersion,
      ...(options.includeDebug ? { options } : {}),
    },
  };
}

/**
 * Build a failed IWorkflowConversionResult.
 */
export function buildFailureResult<TInput extends IWorkflowData, TOutput extends IWorkflowData>(
  errors: string[],
  warnings: string[],
  startTime: number,
  input: TInput,
  _logger: ILogger,
  converterName: string,
  converterVersion: string,
  getStatsFn: (d: Record<string, TUniversalValue>) => { nodeCount: number; edgeCount: number },
): IWorkflowConversionResult<TOutput> {
  const now = new Date();
  const processingTime = now.getTime() - startTime;
  return {
    data: undefined as unknown as TOutput,
    success: false,
    errors,
    warnings,
    metadata: {
      convertedAt: now,
      processingTime,
      inputStats: getStatsFn(input as Record<string, TUniversalValue>),
      outputStats: { nodeCount: 0, edgeCount: 0 },
      converter: converterName,
      version: converterVersion,
    },
  };
}

/**
 * Default input validation: checks for null/undefined only.
 * Subclasses should override for specific validation.
 */
export function defaultValidateInput<TInput extends IWorkflowData>(
  input: TInput,
): { isValid: boolean; errors: string[]; warnings: string[] } {
  if (input == null) {
    return { isValid: false, errors: ['Input data is null or undefined'], warnings: [] };
  }
  return { isValid: true, errors: [], warnings: [] };
}

/**
 * Default output validation: checks for null/undefined only.
 * Subclasses should override for specific validation.
 */
export function defaultValidateOutput<TOutput extends IWorkflowData>(
  output: TOutput,
): { isValid: boolean; errors: string[]; warnings: string[] } {
  if (output == null) {
    return { isValid: false, errors: ['Output data is null or undefined'], warnings: [] };
  }
  return { isValid: true, errors: [], warnings: [] };
}
