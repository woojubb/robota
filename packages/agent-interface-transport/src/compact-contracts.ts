/**
 * Context-compaction event contract (INFRA-025).
 *
 * SSOT for the compaction notification a session emits to transports. Pure data —
 * the compaction engine lives in `agent-session`, which imports this contract.
 */

import type { IContextWindowState } from '@robota-sdk/agent-core';

export type TCompactTrigger = 'manual' | 'auto';

export interface ICompactEvent {
  trigger: TCompactTrigger;
  before: IContextWindowState;
  after: IContextWindowState;
}
