/**
 * Shared type for the execution-round pipeline and its helpers.
 *
 * Extracted so `execution-round-tools.ts` can depend on `IRoundDependencies` without importing
 * `execution-round.ts`, which itself imports `executeAndRecordToolCalls` from
 * `execution-round-tools.ts` — a module-level import cycle. `execution-round.ts` re-exports this
 * name, so existing `from './execution-round'` imports are unaffected.
 */
import type { ExecutionEventEmitter } from './execution-event-emitter';
import type { TPluginWithHooks } from './plugin-hook-dispatcher';
import type { ToolExecutionService } from './tool-execution-service';
import type { ExecutionCacheService } from './cache/execution-cache-service';
import type { ILogger } from '../utils/logger';

export interface IRoundDependencies {
  toolExecutionService: ToolExecutionService;
  plugins: ReadonlyArray<TPluginWithHooks>;
  logger: ILogger;
  eventEmitter: ExecutionEventEmitter;
  cacheService?: ExecutionCacheService;
}
