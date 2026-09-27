/**
 * #3288 §1: one true-status label for an execution-workspace entry, shared by the Agents panel row
 * and its detail sheet so the two never say something different about the same entry.
 *
 * A completed task whose result still reports a refused tool call is not "Done" — it is "Needs
 * permission" (retrospective: the run is over, but something in it was refused). That is distinct
 * from `attention === 'permission'`, which means a turn is PARKED waiting for an answer right now
 * ("Needs you").
 */
import type {
  IExecutionWorkspaceEntry,
  TExecutionAttention,
  TExecutionWorkspaceStatus,
} from '@robota-sdk/agent-interface-execution';

export type TExecutionStatusTone = 'warning' | 'destructive' | 'success' | 'muted';

export interface IExecutionStatusLabel {
  readonly label: string;
  readonly tone: TExecutionStatusTone;
}

export function hadDeniedToolCalls(
  status: TExecutionWorkspaceStatus,
  deniedToolCalls: number | undefined,
): boolean {
  return status === 'completed' && (deniedToolCalls ?? 0) > 0;
}

export function describeExecutionEntryStatus(
  entry: Pick<IExecutionWorkspaceEntry, 'status' | 'attention' | 'deniedToolCalls'>,
): IExecutionStatusLabel | null {
  return describeExecutionStatus(entry.status, entry.attention, entry.deniedToolCalls);
}

export function describeExecutionStatus(
  status: TExecutionWorkspaceStatus,
  attention: TExecutionAttention,
  deniedToolCalls: number | undefined,
): IExecutionStatusLabel | null {
  if (attention === 'permission' || status === 'waiting_permission') {
    return { label: 'Needs you', tone: 'warning' };
  }
  if (attention === 'failed' || status === 'failed') {
    return { label: 'Failed', tone: 'destructive' };
  }
  if (hadDeniedToolCalls(status, deniedToolCalls)) {
    return { label: 'Needs permission', tone: 'warning' };
  }
  if (status === 'completed') return { label: 'Done', tone: 'muted' };
  if (status === 'cancelled') return { label: 'Stopped', tone: 'muted' };
  if (status === 'queued') return { label: 'Queued', tone: 'muted' };
  if (status === 'running') return { label: 'Running', tone: 'muted' };
  return null;
}
