/**
 * Server-side transport guard for API-001 terminal effort outcomes.
 *
 * The provider adapter owns the value: this collector only records the one callback it receives and
 * refuses to serialize a selected-effort response when the adapter omitted or duplicated it. That
 * makes a missing adapter implementation visible at the server boundary instead of asking the remote
 * client to fabricate a competing result.
 */

import type { IModelEffortOutcome } from '@robota-sdk/agent-core';

export interface IRemoteModelEffortOutcomeCollector {
  observe(outcome: IModelEffortOutcome): void;
  terminalForSelection(selected: boolean): IModelEffortOutcome | undefined;
}

export function createRemoteModelEffortOutcomeCollector(): IRemoteModelEffortOutcomeCollector {
  let count = 0;
  let terminal: IModelEffortOutcome | undefined;

  return {
    observe(outcome) {
      count += 1;
      if (count === 1) terminal = outcome;
    },
    terminalForSelection(selected) {
      if (!selected) return undefined;
      if (count !== 1 || terminal === undefined) {
        throw new Error(
          `Server provider must emit exactly one model-effort outcome for a selected request; received ${count}`,
        );
      }
      return terminal;
    },
  };
}
