/**
 * @fileoverview Module Event Data Interfaces
 *
 * Standard module event data structures for consistent event communication.
 * Extracted from abstract-module.ts for separation of concerns.
 */

/**
 * Base module event data interface
 */
export interface IBaseModuleEventData {
  moduleName: string;
  moduleType: string;
  timestamp: Date;
  metadata?: Record<string, string | number | boolean | Date>;
}

/**
 * Module initialization event data
 */
export interface IModuleInitializationEventData extends IBaseModuleEventData {
  phase: 'start' | 'complete' | 'error';
  duration?: number;
  error?: string;
  options?: Record<string, string | number | boolean>;
}

/**
 * Module execution event data
 */
export interface IModuleExecutionEventData extends IBaseModuleEventData {
  phase: 'start' | 'complete' | 'error';
  executionId: string;
  duration?: number;
  success?: boolean;
  error?: string;
  inputSize?: number;
  outputSize?: number;
  context?: {
    sessionId?: string;
    userId?: string;
    agentName?: string;
  };
}

/**
 * Module disposal event data
 */
export interface IModuleDisposalEventData extends IBaseModuleEventData {
  phase: 'start' | 'complete' | 'error';
  duration?: number;
  error?: string;
  resourcesReleased?: string[];
}

/**
 * Module capability event data (for capability registration/changes)
 */
export interface IModuleCapabilityEventData extends IBaseModuleEventData {
  action: 'registered' | 'updated' | 'removed';
  capabilities: string[];
  dependencies?: string[];
}

/**
 * Module health event data (for monitoring and diagnostics)
 */
export interface IModuleHealthEventData extends IBaseModuleEventData {
  status: 'healthy' | 'warning' | 'error' | 'critical';
  metrics: {
    memoryUsage?: number;
    cpuUsage?: number;
    executionCount?: number;
    errorCount?: number;
    averageResponseTime?: number;
  };
  issues?: Array<{
    severity: 'low' | 'medium' | 'high' | 'critical';
    message: string;
    code?: string;
  }>;
}
