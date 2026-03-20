/**
 * Type definitions for AbstractPlugin.
 *
 * Extracted from abstract-plugin.ts to keep each file under 300 lines.
 */
import type { IRunOptions } from '../interfaces/agent';
import type { TUniversalMessage } from '../interfaces/messages';
import type {
  TToolParameters,
  IToolExecutionResult,
  IToolExecutionContext,
} from '../interfaces/tool';
import type {
  IEventEmitterEventData,
  IEventEmitterPlugin,
  TEventName,
} from '../plugins/event-emitter/types';

/** Plugin categories for classification */
export enum PluginCategory {
  MONITORING = 'monitoring',
  LOGGING = 'logging',
  STORAGE = 'storage',
  NOTIFICATION = 'notification',
  SECURITY = 'security',
  PERFORMANCE = 'performance',
  ERROR_HANDLING = 'error_handling',
  LIMITS = 'limits',
  EVENT_PROCESSING = 'event_processing',
  CUSTOM = 'custom',
}

const PRIORITY_CRITICAL = 1000;
const PRIORITY_HIGH = 800;
const PRIORITY_NORMAL = 500;
const PRIORITY_LOW = 200;
const PRIORITY_MINIMAL = 100;

/** Plugin priority levels */
export enum PluginPriority {
  CRITICAL = PRIORITY_CRITICAL,
  HIGH = PRIORITY_HIGH,
  NORMAL = PRIORITY_NORMAL,
  LOW = PRIORITY_LOW,
  MINIMAL = PRIORITY_MINIMAL,
}

/** Plugin execution context for all plugins */
export interface IPluginExecutionContext {
  executionId?: string;
  sessionId?: string;
  userId?: string;
  messages?: TUniversalMessage[];
  config?: Record<string, string | number | boolean>;
  metadata?: Record<string, string | number | boolean | Date>;
  [key: string]:
    | string
    | number
    | boolean
    | Date
    | string[]
    | number[]
    | boolean[]
    | TUniversalMessage[]
    | Record<string, string | number | boolean>
    | Record<string, string | number | boolean | Date>
    | undefined;
}

/** Plugin execution result for all plugins */
export interface IPluginExecutionResult {
  response?: string;
  content?: string;
  duration?: number;
  tokensUsed?: number;
  toolsExecuted?: number;
  success?: boolean;
  usage?: { totalTokens?: number; promptTokens?: number; completionTokens?: number };
  toolCalls?: Array<{
    id?: string;
    name?: string;
    arguments?: Record<string, string | number | boolean>;
    result?: string | number | boolean | null;
  }>;
  results?: Array<{
    id?: string;
    type?: string;
    data?: string | number | boolean | null;
    success?: boolean;
  }>;
  error?: Error;
  metadata?: Record<string, string | number | boolean | Date>;
}

/** Error context for plugin error handling */
export interface IPluginErrorContext {
  action: string;
  tool?: string;
  parameters?: TToolParameters;
  result?: IToolExecutionResult;
  error?: Error;
  executionId?: string;
  sessionId?: string;
  userId?: string;
  timestamp?: Date;
  attempt?: number;
  stack?: string;
  metadata?: Record<string, string | number | boolean>;
}

/** Plugin configuration interface */
export interface IPluginConfig extends IPluginOptions {
  options?: Record<string, string | number | boolean>;
}

/** Plugin options that all plugin options should extend */
export interface IPluginOptions {
  enabled?: boolean;
  category?: PluginCategory;
  priority?: PluginPriority | number;
  moduleEvents?: TEventName[];
  subscribeToAllModuleEvents?: boolean;
}

/** Plugin data interface */
export interface IPluginData {
  name: string;
  version: string;
  enabled: boolean;
  category: PluginCategory;
  priority: number;
  subscribedEvents: TEventName[];
  metadata?: Record<string, string | number | boolean>;
}

/** Type-safe plugin interface with specific type parameters */
export interface IPluginContract<
  TOptions extends IPluginOptions = IPluginOptions,
  TStats = IPluginStats,
> {
  name: string;
  version: string;
  enabled: boolean;
  category: PluginCategory;
  priority: number;
  initialize(options?: TOptions): Promise<void>;
  cleanup?(): Promise<void>;
  getData?(): IPluginData;
  getStats?(): TStats;
  subscribeToModuleEvents?(eventEmitter: IEventEmitterPlugin): Promise<void>;
  unsubscribeFromModuleEvents?(eventEmitter: IEventEmitterPlugin): Promise<void>;
  onModuleEvent?(eventName: TEventName, eventData: IEventEmitterEventData): Promise<void> | void;
}

/** Plugin statistics base interface with common metrics */
export interface IPluginStats {
  enabled: boolean;
  calls: number;
  errors: number;
  lastActivity?: Date;
  moduleEventsReceived?: number;
  [key: string]:
    | string
    | number
    | boolean
    | Date
    | string[]
    | number[]
    | boolean[]
    | Record<string, string | number | boolean | Date>
    | undefined;
}

/** Plugin interface extending IPluginContract */
export interface IPlugin extends IPluginContract<IPluginConfig, IPluginStats> {}

/** Plugin lifecycle hooks */
export interface IPluginHooks {
  beforeRun?(input: string, options?: IRunOptions): Promise<void> | void;
  afterRun?(input: string, response: string, options?: IRunOptions): Promise<void> | void;
  beforeExecution?(context: IPluginExecutionContext): Promise<void> | void;
  afterExecution?(
    context: IPluginExecutionContext,
    result: IPluginExecutionResult,
  ): Promise<void> | void;
  beforeConversation?(context: IPluginExecutionContext): Promise<void> | void;
  afterConversation?(
    context: IPluginExecutionContext,
    result: IPluginExecutionResult,
  ): Promise<void> | void;
  beforeToolCall?(toolName: string, parameters: TToolParameters): Promise<void> | void;
  beforeToolExecution?(
    context: IPluginExecutionContext,
    toolData: IToolExecutionContext,
  ): Promise<void> | void;
  afterToolCall?(
    toolName: string,
    parameters: TToolParameters,
    result: IToolExecutionResult,
  ): Promise<void> | void;
  afterToolExecution?(
    context: IPluginExecutionContext,
    toolResults: IPluginExecutionResult,
  ): Promise<void> | void;
  beforeProviderCall?(messages: TUniversalMessage[]): Promise<void> | void;
  afterProviderCall?(
    messages: TUniversalMessage[],
    response: TUniversalMessage,
  ): Promise<void> | void;
  onStreamingChunk?(chunk: TUniversalMessage): Promise<void> | void;
  onError?(error: Error, context?: IPluginErrorContext): Promise<void> | void;
  onMessageAdded?(message: TUniversalMessage): Promise<void> | void;
  onModuleEvent?(eventName: TEventName, eventData: IEventEmitterEventData): Promise<void> | void;
}
