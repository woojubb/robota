import { CircleCheck, CircleDashed, CircleX, LoaderCircle, ShieldAlert } from 'lucide-react';
import React from 'react';

import type {
  IExecutionWorkspaceEntry,
  TExecutionAttention,
  TExecutionWorkspaceStatus,
} from '@robota-sdk/agent-interface-execution';

interface IAgentActivityPanelProps {
  tasks: readonly IExecutionWorkspaceEntry[];
  className?: string;
}

export function AgentActivityPanel({
  tasks,
  className,
}: IAgentActivityPanelProps): React.ReactElement {
  const runningCount = tasks.filter((t) => t.status === 'running').length;

  return (
    <div className={`flex flex-col overflow-hidden ${className ?? ''}`}>
      <div className="flex h-12 flex-shrink-0 items-center gap-2 px-4">
        <span className="text-[14px] font-medium text-foreground">Agents</span>
        {runningCount > 0 && (
          <span className="ml-auto text-[13px] tabular-nums text-subtle">
            {runningCount} running
          </span>
        )}
      </div>

      <div className="flex-1 space-y-2 overflow-y-auto px-3 pb-3">
        {tasks.map((entry) => (
          <AgentCard key={entry.id} entry={entry} />
        ))}
      </div>
    </div>
  );
}

function AgentCard({ entry }: { entry: IExecutionWorkspaceEntry }): React.ReactElement {
  const needsYou = entry.attention === 'permission' || entry.status === 'waiting_permission';
  const failed = entry.attention === 'failed' || entry.status === 'failed';
  return (
    <div
      className={`rounded-xl px-3.5 py-3 transition-opacity duration-500 ${
        needsYou ? 'bg-warning/10' : failed ? 'bg-destructive/10' : 'bg-card'
      } ${entry.status === 'completed' ? 'opacity-60' : ''}`}
    >
      <div className="flex items-center gap-2.5">
        <StatusIcon status={entry.status} attention={entry.attention} />
        <span className="min-w-0 flex-1 truncate text-[14px] font-medium text-foreground">
          {entry.title}
        </span>
        <AttentionTag attention={entry.attention} status={entry.status} />
      </div>
      {entry.currentAction && (
        <p className="mt-1.5 truncate pl-[26px] text-[13px] leading-snug text-muted-foreground">
          {entry.currentAction}
        </p>
      )}
      {entry.preview && (
        <p className="mt-1 truncate pl-[26px] font-mono text-[12px] leading-snug text-subtle">
          {entry.preview}
        </p>
      )}
    </div>
  );
}

function StatusIcon({
  status,
  attention,
}: {
  status: TExecutionWorkspaceStatus;
  attention: TExecutionAttention;
}): React.ReactElement {
  const props = { size: 16, strokeWidth: 1.9, className: 'flex-shrink-0' } as const;
  if (attention === 'permission' || status === 'waiting_permission') {
    return <ShieldAlert {...props} className={`${props.className} text-warning`} />;
  }
  if (attention === 'failed' || status === 'failed') {
    return <CircleX {...props} className={`${props.className} text-destructive`} />;
  }
  if (status === 'running') {
    return <LoaderCircle {...props} className={`${props.className} animate-spin text-muted-foreground`} />;
  }
  if (status === 'completed') {
    return <CircleCheck {...props} className={`${props.className} text-success`} />;
  }
  return <CircleDashed {...props} className={`${props.className} text-subtle`} />;
}

function AttentionTag({
  attention,
  status,
}: {
  attention: TExecutionAttention;
  status: TExecutionWorkspaceStatus;
}): React.ReactElement | null {
  const tag = (label: string, tone: string): React.ReactElement => (
    <span className={`flex-shrink-0 rounded-md px-1.5 py-px text-[12px] ${tone}`}>{label}</span>
  );
  if (attention === 'permission' || status === 'waiting_permission') {
    return tag('Needs you', 'bg-warning/15 text-warning');
  }
  if (attention === 'failed' || status === 'failed') {
    return tag('Failed', 'bg-destructive/12 text-destructive');
  }
  if (status === 'completed') return tag('Done', 'text-subtle');
  if (status === 'queued') return tag('Queued', 'text-subtle');
  return null;
}
