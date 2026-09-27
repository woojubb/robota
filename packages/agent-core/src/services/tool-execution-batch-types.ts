/**
 * Shared type for ToolExecutionService and its batch-execution helper.
 *
 * Extracted so `tool-execution-service.ts` and `tool-execution-batch.ts` can both depend on this
 * type without importing from one another (avoids a module-level import cycle).
 * @internal
 */
import type { IToolExecutionRequest } from '../interfaces/service';
import type {
  IToolExecutionContext,
  IToolExecutionResult,
  TToolParameters,
} from '../interfaces/tool';

export interface IToolExecutionBatchContext {
  requests: IToolExecutionRequest[];
  mode: 'parallel' | 'sequential';
  timeout?: number;
  continueOnError?: boolean;
  maxConcurrency?: number;
  parentContext?: IToolExecutionContext;
  /** AbortSignal — queued tools are skipped when aborted */
  signal?: AbortSignal;
  /** Validated durable settlements; these indices never enter a tool body again. */
  recoveredResults?: ReadonlyMap<number, IToolExecutionResult>;
  /** Awaited per-action boundaries, supplied by the execution owner rather than tool bodies. */
  journal?: {
    beforeDispatch(index: number): Promise<void>;
    beforeEffect?(index: number, parameters: TToolParameters): Promise<void>;
    onResult(index: number, result: IToolExecutionResult): Promise<void>;
  };
}
