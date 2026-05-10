import React from 'react';
import type {
  IExecutionWorkspaceEntry,
  TExecutionAttention,
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

  return (
    <div className={`flex flex-col overflow-hidden bg-card/10 ${className ?? ''}`}>
      {/* Header */}
      <div className="px-3 py-2 border-b border-border/50 flex items-center gap-2 flex-shrink-0">
        {runningCount > 0 ? (
          <span className="relative flex h-1.5 w-1.5 flex-shrink-0">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-60" />
            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-amber-500" />
          </span>
        ) : (
          <span className="h-1.5 w-1.5 rounded-full bg-zinc-600 flex-shrink-0" />
        )}
        <span className="text-[10px] font-mono font-semibold tracking-[0.14em] uppercase text-muted-foreground">
          Agents
        </span>
        {runningCount > 0 && (
          <span className="ml-auto text-[10px] font-mono text-amber-400/70 tabular-nums">
            {runningCount} running
          </span>
        )}
      </div>

      {/* Card list */}
      <div className="flex-1 overflow-y-auto px-2 py-2 space-y-1.5">
        {tasks.map((entry) => (
          <AgentCard key={entry.id} entry={entry} />
        ))}
      </div>
    </div>
  );
}

function AgentCard({ entry }: { entry: IExecutionWorkspaceEntry }): React.ReactElement {
  const tokens = getStatusTokens(entry.status, entry.attention);

  return (
    <div
      className={`relative rounded-md overflow-hidden border transition-opacity duration-500 ${tokens.cardCls} ${entry.status === 'completed' ? 'opacity-40' : ''}`}
    >
      {/* Left accent bar */}
      <div className={`absolute left-0 top-0 bottom-0 w-0.5 ${tokens.barCls}`} />

      <div className="pl-3.5 pr-3 py-2">
        {/* Title row */}
        <div className="flex items-center gap-2">
          <StatusDot status={entry.status} attention={entry.attention} />
          <span className="text-[11px] font-mono font-medium text-foreground/90 truncate flex-1 leading-none">
            {entry.title}
          </span>
          <AttentionTag attention={entry.attention} status={entry.status} />
        </div>

        {/* Current action */}
        {entry.currentAction && (
          <p className="text-[10px] text-foreground/50 leading-snug mt-1.5 truncate">
            {entry.currentAction}
          </p>
        )}

        {/* Preview */}
        {entry.preview && (
          <p className="text-[10px] font-mono text-muted-foreground/40 leading-snug mt-0.5 truncate">
            &ldquo;{entry.preview}&rdquo;
          </p>
        )}
      </div>
    </div>
  );
}

function StatusDot({
  status,
  attention,
}: {
  status: TExecutionWorkspaceStatus;
  attention: TExecutionAttention;
}): React.ReactElement {
  if (attention === 'permission' || status === 'waiting_permission') {
    return (
      <span className="relative flex h-1.5 w-1.5 flex-shrink-0">
        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-400 opacity-70" />
        <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-rose-500" />
      </span>
    );
  }
  if (attention === 'failed' || status === 'failed') {
    return <span className="h-1.5 w-1.5 rounded-full bg-rose-500 flex-shrink-0" />;
  }
  if (status === 'running') {
    return (
      <span className="relative flex h-1.5 w-1.5 flex-shrink-0">
        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-55" />
        <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-amber-400" />
      </span>
    );
  }
  if (status === 'completed') {
    return <span className="h-1.5 w-1.5 rounded-full bg-emerald-400/60 flex-shrink-0" />;
  }
  return <span className="h-1.5 w-1.5 rounded-full bg-zinc-600 flex-shrink-0" />;
}

function AttentionTag({
  attention,
  status,
}: {
  attention: TExecutionAttention;
  status: TExecutionWorkspaceStatus;
}): React.ReactElement | null {
  if (attention === 'permission' || status === 'waiting_permission') {
    return (
      <span className="text-[9px] font-mono text-rose-400 bg-rose-500/10 border border-rose-500/25 px-1.5 py-px rounded flex-shrink-0">
        perm
      </span>
    );
  }
  if (attention === 'failed' || status === 'failed') {
    return (
      <span className="text-[9px] font-mono text-rose-400 bg-rose-500/10 border border-rose-500/25 px-1.5 py-px rounded flex-shrink-0">
        err
      </span>
    );
  }
  if (status === 'completed') {
    return <span className="text-[9px] font-mono text-emerald-400/50 flex-shrink-0">done</span>;
  }
  if (status === 'queued') {
    return <span className="text-[9px] font-mono text-zinc-500 flex-shrink-0">queued</span>;
  }
  return null;
}

function getStatusTokens(
  status: TExecutionWorkspaceStatus,
  attention: TExecutionAttention,
): { cardCls: string; barCls: string } {
  if (attention === 'permission' || status === 'waiting_permission') {
    return { cardCls: 'border-rose-500/40 bg-rose-950/10', barCls: 'bg-rose-400' };
  }
  if (attention === 'failed' || status === 'failed') {
    return { cardCls: 'border-rose-500/30 bg-rose-950/15', barCls: 'bg-rose-500' };
  }
  if (status === 'running') {
    return { cardCls: 'border-amber-500/20 bg-card/30', barCls: 'bg-amber-400' };
  }
  if (status === 'completed') {
    return { cardCls: 'border-border/20 bg-card/20', barCls: 'bg-emerald-400/50' };
  }
  return { cardCls: 'border-border/30 bg-card/25', barCls: 'bg-zinc-600/50' };
}
