import React from 'react';
import type {
  IExecutionWorkspaceEntry,
  TExecutionWorkspaceStatus,
} from '@robota-sdk/agent-transport-ws';

interface IAgentActivityPanelProps {
  tasks: readonly IExecutionWorkspaceEntry[];
  className?: string;
}

export function AgentActivityPanel({
  tasks,
  className,
}: IAgentActivityPanelProps): React.ReactElement {
  const runningCount = tasks.filter((t) => t.status === 'running').length;
  const label = runningCount > 0 ? `AGENTS (${runningCount} running)` : 'AGENTS';

  return (
    <div className={`flex flex-col overflow-hidden ${className ?? ''}`}>
      <div className="px-3 py-2 border-b border-border/50 flex-shrink-0">
        <span className="text-[10px] font-mono font-semibold tracking-[0.14em] uppercase text-muted-foreground">
          {label}
        </span>
      </div>
      <div className="flex-1 overflow-y-auto px-2 py-2 space-y-2">
        {tasks.map((entry) => (
          <AgentCard key={entry.id} entry={entry} />
        ))}
      </div>
    </div>
  );
}

function AgentCard({ entry }: { entry: IExecutionWorkspaceEntry }): React.ReactElement {
  const { dot, cardBorder } = getStatusStyle(entry);
  const attentionBadge = getAttentionBadge(entry.attention);

  return (
    <div
      className={`rounded-lg border bg-card/40 px-3 py-2.5 ${cardBorder} ${entry.status === 'completed' ? 'opacity-50' : ''}`}
    >
      <div className="flex items-center gap-2 mb-1">
        <span className={`h-2 w-2 rounded-full flex-shrink-0 ${dot}`} />
        <span className="text-xs font-mono font-medium text-foreground truncate flex-1">
          {entry.title}
        </span>
        <span className="text-[10px] font-mono text-muted-foreground flex-shrink-0">
          {entry.status}
        </span>
        {attentionBadge}
      </div>
      {entry.currentAction && (
        <p className="text-[11px] text-foreground/70 leading-snug mt-0.5 truncate">
          {entry.currentAction}
        </p>
      )}
      {entry.preview && (
        <p className="text-[10px] font-mono text-muted-foreground/70 leading-snug mt-0.5 truncate">
          &ldquo;{entry.preview}&rdquo;
        </p>
      )}
    </div>
  );
}

function getStatusStyle(entry: IExecutionWorkspaceEntry): {
  dot: string;
  cardBorder: string;
} {
  const status: TExecutionWorkspaceStatus = entry.status;
  const attention = entry.attention;

  if (attention === 'permission') {
    return {
      dot: 'bg-rose-400 animate-pulse',
      cardBorder: 'border-rose-500/60',
    };
  }
  if (attention === 'failed' || status === 'failed') {
    return {
      dot: 'bg-rose-500',
      cardBorder: 'border-rose-500/40 bg-rose-950/20',
    };
  }

  switch (status) {
    case 'running':
      return { dot: 'bg-amber-400 animate-pulse', cardBorder: 'border-border/40' };
    case 'waiting_permission':
      return { dot: 'bg-rose-400 animate-pulse', cardBorder: 'border-rose-500/60' };
    case 'completed':
      return { dot: 'bg-emerald-400', cardBorder: 'border-border/30' };
    case 'queued':
      return { dot: 'bg-zinc-500', cardBorder: 'border-border/30' };
    default:
      return { dot: 'bg-zinc-500', cardBorder: 'border-border/30' };
  }
}

function getAttentionBadge(attention: IExecutionWorkspaceEntry['attention']): React.ReactNode {
  if (attention === 'permission') {
    return (
      <span className="text-[9px] font-mono bg-rose-500/20 text-rose-400 px-1.5 py-0.5 rounded border border-rose-500/30 flex-shrink-0">
        Permission
      </span>
    );
  }
  if (attention === 'failed') {
    return (
      <span className="text-[9px] font-mono bg-rose-500/20 text-rose-400 px-1.5 py-0.5 rounded border border-rose-500/30 flex-shrink-0">
        Failed
      </span>
    );
  }
  return null;
}
