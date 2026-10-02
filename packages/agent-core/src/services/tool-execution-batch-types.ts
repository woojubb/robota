/**
 * Shared type for ToolExecutionService and its batch-execution helper.
 *
 * Extracted so `tool-execution-service.ts` and `tool-execution-batch.ts` can both depend on this
 * type without importing from one another (avoids a module-level import cycle).
 * @internal
 */
import type { IToolExecutionRequest } from '../interfaces/service';
import type { IToolContinuation } from '../interfaces/tool-continuation';
import type {
  IToolExecutionContext,
  IToolExecutionResult,
  TToolParameters,
  IToolCallScheduling,
} from '../interfaces/tool';
export type { IToolCallScheduling } from '../interfaces/tool';

export interface IToolExecutionBatchContext {
  requests: IToolExecutionRequest[];
  mode: 'parallel' | 'sequential';
  timeout?: number;
  continueOnError?: boolean;
  maxConcurrency?: number;
  /** Call-ID policy, snapshotted and validated before dispatch. Missing calls are conservative. */
  scheduling?: ReadonlyMap<string, IToolCallScheduling>;
  parentContext?: IToolExecutionContext;
  /** AbortSignal — queued tools are skipped when aborted */
  signal?: AbortSignal;
  /** Validated durable settlements; these indices never enter a tool body again. */
  recoveredResults?: ReadonlyMap<number, IToolExecutionResult>;
  /** Observers of dispatched attempts; restored settlements do not re-enter them. */
  lifecycle?: {
    beforeDispatch(index: number, context: IToolExecutionContext): Promise<void>;
    onResult(
      index: number,
      context: IToolExecutionContext,
      result: IToolExecutionResult,
    ): Promise<void>;
  };
  /** Awaited per-action boundaries, supplied by the execution owner rather than tool bodies. */
  journal?: {
    continuation?(index: number): IToolContinuation;
    /** Drain pre-effect requests and preserve control flow even if a wrapper normalized its error. */
    settle?(index: number): Promise<void>;
    beforeDispatch(index: number): Promise<void>;
    beforeEffect?(index: number, parameters: TToolParameters): Promise<void>;
    onResult(index: number, result: IToolExecutionResult): Promise<void>;
  };
}
