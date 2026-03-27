import type { IEventService } from '../interfaces/event-service';
import type { IUniversalObjectValue, TUniversalValue } from '../interfaces/types';

/**
 * Configuration for execution proxy
 */
export interface IExecutionProxyConfig {
  eventService: IEventService;
  sourceType: 'agent' | 'team' | 'tool';
  sourceId: string;
  enabledEvents?: {
    execution?: boolean;
    toolCall?: boolean;
    task?: boolean;
  };
}

/** Internal target shape for proxy interception */
export type TExecutionProxyTarget = Record<string, TUniversalValue>;

/** Internal args shape for proxy interception */
export type TExecutionProxyArgs = TUniversalValue[];

/**
 * Metadata extractor function type
 */
export type TMetadataExtractor = (
  target: TExecutionProxyTarget,
  methodName: string,
  args: TExecutionProxyArgs,
) => Record<string, TUniversalValue>;

/**
 * Method configuration for proxy
 */
export interface IMethodConfig {
  startEvent?: string;
  completeEvent?: string;
  errorEvent?: string;
  extractMetadata?: TMetadataExtractor;
  extractResult?: (result: TUniversalValue) => Record<string, TUniversalValue>;
}

/**
 * Narrow TUniversalValue to IUniversalObjectValue (object, not array, not Date).
 */
export function asObjectValue(
  input: TUniversalValue | undefined,
): IUniversalObjectValue | undefined {
  if (!input || typeof input !== 'object' || Array.isArray(input) || input instanceof Date) {
    return undefined;
  }
  return input as IUniversalObjectValue;
}

/**
 * Return the string length of input, or 0 if not a string.
 */
export function getStringLength(input: TUniversalValue | undefined): number {
  return typeof input === 'string' ? input.length : 0;
}
