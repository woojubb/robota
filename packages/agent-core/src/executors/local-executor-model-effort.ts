import type { IModelEffortOutcome } from '../interfaces/model-effort-capability';
import type { IChatOptions } from '../interfaces/provider';

interface IModelEffortOutcomeCollector {
  observe(outcome: IModelEffortOutcome): void;
  terminal(providerName: string): IModelEffortOutcome | undefined;
}

/** Collect exactly one adapter-owned terminal outcome per executor request. */
export function createModelEffortOutcomeCollector(): IModelEffortOutcomeCollector {
  let outcome: IModelEffortOutcome | undefined;
  let count = 0;

  return {
    observe(nextOutcome): void {
      count += 1;
      if (count === 1) outcome = nextOutcome;
    },
    terminal(providerName): IModelEffortOutcome | undefined {
      if (count > 1) {
        throw new Error(`Provider "${providerName}" emitted ${count} model-effort outcomes`);
      }
      return outcome;
    },
  };
}

/** Invoke the caller callback only after the executor has a terminal outcome. */
export function notifyModelEffortOutcome(
  logger: { warn(message: string, data: Record<string, string>): void },
  options: IChatOptions | undefined,
  outcome: IModelEffortOutcome | undefined,
): void {
  if (outcome === undefined || options?.onModelEffortOutcome === undefined) return;
  try {
    options.onModelEffortOutcome(outcome);
  } catch (error) {
    logger.warn('Model-effort outcome observer failed', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
