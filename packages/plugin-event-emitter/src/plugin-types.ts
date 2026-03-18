/**
 * Type definitions for EventEmitterPlugin.
 *
 * Extracted from event-emitter-plugin.ts to keep each file under 300 lines.
 */
import type {
  IPluginExecutionContext,
  IPluginExecutionResult,
  IPluginOptions,
  IPluginStats,
  TToolParameters,
  IToolResult,
} from '@robota-sdk/agents';
import type { IEventEmitterEventData, TEventName, TEventEmitterListener } from './types';
import type { IEventEmitterMetrics } from './metrics';

export type { TEventName };
export type { IEventEmitterEventData };
export type { TEventEmitterListener };

/** Basic event execution value types */
export type TEventExecutionValue =
  | string
  | number
  | boolean
  | Date
  | string[]
  | number[]
  | boolean[]
  | Record<string, string | number | boolean | null>
  | null
  | undefined;

/** Event execution context data with type safety */
export interface IEventExecutionContextData {
  messageCount?: number | undefined;
  config?: Record<string, TEventExecutionValue> | undefined;
  result?: IPluginExecutionResult | undefined;
  duration?: number | undefined;
  tokensUsed?: number | undefined;
  toolsExecuted?: number | undefined;
  messages?: Record<string, TEventExecutionValue>[] | undefined;
  response?: string | undefined;
  toolCalls?: Record<string, TEventExecutionValue>[] | undefined;
  [key: string]:
    | TEventExecutionValue
    | Record<string, TEventExecutionValue>
    | Record<string, TEventExecutionValue>[]
    | IPluginExecutionResult
    | undefined;
}

/** Event metadata */
export type TEventEmitterMetadata = Record<
  string,
  string | number | boolean | Date | string[] | number[] | undefined
>;

/** Plugin execution context for event emitter */
export interface IEventEmitterPluginExecutionContext extends IPluginExecutionContext {
  // Override config to support additional types
}

/** Plugin execution result for event emitter */
export interface IEventEmitterPluginExecutionResult {
  content?: string;
  response?: string;
  duration?: number;
  tokensUsed?: number;
  toolsExecuted?: number;
  usage?: Record<string, TEventExecutionValue>;
  toolCalls?: Record<string, TEventExecutionValue>[];
  [key: string]:
    | TEventExecutionValue
    | Record<string, TEventExecutionValue>
    | Record<string, TEventExecutionValue>[]
    | undefined;
}

/** Enhanced event data for hierarchical execution tracking */
export interface IEventEmitterHierarchicalEventData extends IEventEmitterEventData {
  parentExecutionId?: string;
  rootExecutionId?: string;
  executionLevel: number;
  executionPath: string[];
  realTimeData?: {
    startTime: Date;
    actualDuration?: number;
    actualParameters?: TToolParameters;
    actualResult?: IToolResult;
  };
}

/** @internal */
interface IEventEmitterHandlerRegistration {
  id: string;
  listener: TEventEmitterListener;
  once: boolean;
  filter?: (event: IEventEmitterEventData) => boolean;
}

export type { IEventEmitterHandlerRegistration };

/** Event emitter configuration */
export interface IEventEmitterPluginOptions extends IPluginOptions {
  events?: TEventName[];
  maxListeners?: number;
  async?: boolean;
  catchErrors?: boolean;
  filters?: Record<TEventName, (event: IEventEmitterEventData) => boolean>;
  buffer?: {
    enabled: boolean;
    maxSize: number;
    flushInterval: number;
  };
  metrics?: IEventEmitterMetrics;
}

/** Event emitter plugin statistics */
export interface IEventEmitterPluginStats extends IPluginStats {
  eventTypes: TEventName[];
  listenerCounts: Partial<Record<TEventName, number>>;
  totalListeners: number;
  bufferedEvents: number;
  totalEmitted: number;
  totalErrors: number;
}
