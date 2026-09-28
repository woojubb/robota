import {
  CircleCheck,
  CircleDashed,
  CircleX,
  LoaderCircle,
  Pause,
  Play,
  ShieldAlert,
  Square,
  Target,
} from 'lucide-react';
import React, { useState } from 'react';

import { ConfirmDialog } from './Dialog.js';
import { describeGoalStatus } from '../goal-view.js';
import {
  describeScheduleInstruction,
  describeScheduleStatus,
  describeScheduleTiming,
} from '../schedule-view.js';

import { describeExecutionStatus, hadDeniedToolCalls } from '../execution-entry-status.js';

import type {
  IBackgroundTaskState,
  IExecutionWorkspaceEntry,
  TExecutionAttention,
  TExecutionWorkspaceStatus,
} from '@robota-sdk/agent-interface-execution';
import type { IGoalState } from '@robota-sdk/agent-interface-session';

interface IAgentActivityPanelProps {
  tasks: readonly IExecutionWorkspaceEntry[];
  /** #3282 §4 part b-3: the "Scheduled" group — every `kind: 'scheduled'` background task. */
  schedules?: readonly IBackgroundTaskState<'scheduled'>[];
  /** #3282 §4 part b-3: the current goal (`/goal`), or null/absent when none is set. */
  goal?: IGoalState | null;
  onPauseSchedule?: (taskId: string) => void;
  onResumeSchedule?: (taskId: string) => void;
  onDeleteSchedule?: (taskId: string) => void;
  onCancelGoal?: () => void;
  className?: string;
  /** #3288 §1: open a non-main-thread entry's detail sheet. */
  onSelect?: (entry: IExecutionWorkspaceEntry) => void;
  /** #3288 §1: the main thread entry was clicked — the conversation beside this panel is it. */
  onReturnToConversation?: () => void;
  /** #3288 §1: Stop was clicked on a running/queued entry. */
  onStop?: (entry: IExecutionWorkspaceEntry) => void;
  /** #3288 §1: the entry whose detail sheet is currently open, for a highlighted row. */
  selectedEntryId?: string;
}

export function AgentActivityPanel({
  tasks,
  schedules = [],
  goal = null,
  onPauseSchedule,
  onResumeSchedule,
  onDeleteSchedule,
  onCancelGoal,
  className,
  onSelect,
  onReturnToConversation,
  onStop,
  selectedEntryId,
}: IAgentActivityPanelProps): React.ReactElement {
  const runningCount = tasks.filter((t) => t.status === 'running').length;
  // A deleted schedule is `cancelled` forever (the manager never removes the record) — the group
  // shows only what is still relevant, exactly like Delete disappearing the row it was pressed on.
  const visibleSchedules = schedules.filter((task) => task.status !== 'cancelled');
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const pendingDelete = visibleSchedules.find((task) => task.id === pendingDeleteId) ?? null;

  return (
    <div className={`robota-ui flex flex-col overflow-hidden ${className ?? ''}`}>
      <div className="flex h-12 flex-shrink-0 items-center gap-2 px-4">
        <span className="text-[14px] font-medium text-foreground">Agents</span>
        {runningCount > 0 && (
          <span className="ml-auto text-[13px] tabular-nums text-subtle">
            {runningCount} running
          </span>
        )}
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto px-3 pb-3">
        {tasks.length > 0 && (
          <div className="space-y-2">
            {tasks.map((entry) => (
              <AgentCard
                key={entry.id}
                entry={entry}
                selected={entry.id === selectedEntryId}
                onOpen={
                  entry.kind === 'main_thread'
                    ? onReturnToConversation
                    : onSelect && (() => onSelect(entry))
                }
                onStop={
                  onStop && entry.controls?.includes('cancel') ? () => onStop(entry) : undefined
                }
              />
            ))}
          </div>
        )}

        {visibleSchedules.length > 0 && (
          <div>
            <p className="px-0.5 pb-1.5 text-[12px] font-medium uppercase tracking-wide text-subtle">
              Scheduled
            </p>
            <div className="space-y-2">
              {visibleSchedules.map((task) => (
                <ScheduleCard
                  key={task.id}
                  task={task}
                  onPause={onPauseSchedule}
                  onResume={onResumeSchedule}
                  onRequestDelete={() => setPendingDeleteId(task.id)}
                />
              ))}
            </div>
          </div>
        )}

        {goal && (
          <div>
            <p className="px-0.5 pb-1.5 text-[12px] font-medium uppercase tracking-wide text-subtle">
              Goal
            </p>
            <GoalCard goal={goal} onCancel={onCancelGoal} />
          </div>
        )}
      </div>

      <ConfirmDialog
        open={pendingDelete !== null}
        title="Delete this schedule?"
        body={
          pendingDelete
            ? `"${describeScheduleInstruction(pendingDelete)}" will stop running. This cannot be undone.`
            : ''
        }
        confirmLabel="Delete"
        destructive
        onConfirm={() => {
          if (pendingDelete) onDeleteSchedule?.(pendingDelete.id);
          setPendingDeleteId(null);
        }}
        onCancel={() => setPendingDeleteId(null)}
      />
    </div>
  );
}

function AgentCard({
  entry,
  selected,
  onOpen,
  onStop,
}: {
  entry: IExecutionWorkspaceEntry;
  selected: boolean;
  onOpen?: () => void;
  onStop?: () => void;
}): React.ReactElement {
  const needsYou = entry.attention === 'permission' || entry.status === 'waiting_permission';
  const failed = entry.attention === 'failed' || entry.status === 'failed';
  return (
    <div
      role={onOpen ? 'button' : undefined}
      tabIndex={onOpen ? 0 : undefined}
      onClick={onOpen}
      onKeyDown={
        onOpen
          ? (event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                onOpen();
              }
            }
          : undefined
      }
      aria-label={onOpen ? entry.title : undefined}
      className={`rounded-xl px-3.5 py-3 transition-opacity duration-500 ${
        needsYou ? 'bg-warning/10' : failed ? 'bg-destructive/10' : 'bg-card'
      } ${entry.status === 'completed' ? 'opacity-60' : ''} ${
        selected ? 'ring-1 ring-inset ring-accent' : ''
      } ${onOpen ? 'cursor-pointer' : ''}`}
    >
      <div className="flex items-center gap-2.5">
        <StatusIcon status={entry.status} attention={entry.attention} deniedToolCalls={entry.deniedToolCalls} />
        <span className="min-w-0 flex-1 truncate text-[14px] font-medium text-foreground">
          {entry.title}
        </span>
        <AttentionTag status={entry.status} attention={entry.attention} deniedToolCalls={entry.deniedToolCalls} />
        {onStop && (
          <button
            type="button"
            aria-label={`Stop ${entry.title}`}
            onClick={(event) => {
              event.stopPropagation();
              onStop();
            }}
            className="flex-shrink-0 rounded-md px-1.5 py-px text-[12px] text-subtle hover:bg-destructive/10 hover:text-destructive"
          >
            Stop
          </button>
        )}
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

/** #3282 §4 part b-3: one row of the "Scheduled" group — what it runs, when next, status, controls. */
function ScheduleCard({
  task,
  onPause,
  onResume,
  onRequestDelete,
}: {
  task: IBackgroundTaskState<'scheduled'>;
  onPause?: (taskId: string) => void;
  onResume?: (taskId: string) => void;
  onRequestDelete: () => void;
}): React.ReactElement {
  const isPaused = task.status === 'paused';
  return (
    <div className="rounded-xl bg-card px-3.5 py-3">
      <p className="truncate text-[14px] font-medium text-foreground">
        {describeScheduleInstruction(task)}
      </p>
      <p className="mt-1 text-[13px] text-muted-foreground">
        {describeScheduleTiming(task)} · {describeScheduleStatus(task)}
      </p>
      <div className="mt-2 flex items-center gap-3">
        {isPaused ? (
          <button
            type="button"
            onClick={() => onResume?.(task.id)}
            className="flex items-center gap-1.5 rounded-lg px-2 py-1 text-[13px] text-muted-foreground hover:bg-hover hover:text-foreground"
          >
            <Play size={11} fill="currentColor" aria-hidden="true" />
            Resume
          </button>
        ) : (
          <button
            type="button"
            onClick={() => onPause?.(task.id)}
            className="flex items-center gap-1.5 rounded-lg px-2 py-1 text-[13px] text-muted-foreground hover:bg-hover hover:text-foreground"
          >
            <Pause size={11} fill="currentColor" aria-hidden="true" />
            Pause
          </button>
        )}
        <button
          type="button"
          onClick={onRequestDelete}
          className="flex items-center gap-1.5 rounded-lg px-2 py-1 text-[13px] text-destructive hover:bg-destructive/10"
        >
          Delete…
        </button>
      </div>
    </div>
  );
}

/** #3282 §4 part b-3: the current goal — objective, plain-word status, and Cancel. */
function GoalCard({
  goal,
  onCancel,
}: {
  goal: IGoalState;
  onCancel?: () => void;
}): React.ReactElement {
  return (
    <div className="rounded-xl bg-card px-3.5 py-3">
      <div className="flex items-center gap-2.5">
        <Target size={16} strokeWidth={1.9} className="flex-shrink-0 text-accent" />
        <span className="min-w-0 flex-1 truncate text-[14px] font-medium text-foreground">
          {goal.objective}
        </span>
      </div>
      <p className="mt-1.5 pl-[26px] text-[13px] text-muted-foreground">
        {describeGoalStatus(goal)}
      </p>
      {goal.status === 'active' && (
        <div className="mt-2 pl-[26px]">
          <button
            type="button"
            onClick={onCancel}
            className="flex items-center gap-1.5 rounded-lg px-2 py-1 text-[13px] text-muted-foreground hover:bg-hover hover:text-foreground"
          >
            <Square size={11} fill="currentColor" aria-hidden="true" />
            Cancel goal
          </button>
        </div>
      )}
    </div>
  );
}

function StatusIcon({
  status,
  attention,
  deniedToolCalls,
}: {
  status: TExecutionWorkspaceStatus;
  attention: TExecutionAttention;
  deniedToolCalls?: number;
}): React.ReactElement {
  const props = { size: 16, strokeWidth: 1.9, className: 'flex-shrink-0' } as const;
  if (attention === 'permission' || status === 'waiting_permission') {
    return <ShieldAlert {...props} className={`${props.className} text-warning`} />;
  }
  if (attention === 'failed' || status === 'failed') {
    return <CircleX {...props} className={`${props.className} text-destructive`} />;
  }
  if (hadDeniedToolCalls(status, deniedToolCalls)) {
    return <ShieldAlert {...props} className={`${props.className} text-warning`} />;
  }
  if (status === 'running') {
    return (
      <LoaderCircle
        {...props}
        className={`${props.className} animate-spin text-muted-foreground`}
      />
    );
  }
  if (status === 'completed') {
    return <CircleCheck {...props} className={`${props.className} text-success`} />;
  }
  if (status === 'cancelled') {
    return <CircleX {...props} className={`${props.className} text-subtle`} />;
  }
  return <CircleDashed {...props} className={`${props.className} text-subtle`} />;
}

const STATUS_TAG_TONE: Record<string, string> = {
  warning: 'bg-warning/15 text-warning',
  destructive: 'bg-destructive/12 text-destructive',
  muted: 'text-subtle',
};

function AttentionTag({
  attention,
  status,
  deniedToolCalls,
}: {
  attention: TExecutionAttention;
  status: TExecutionWorkspaceStatus;
  deniedToolCalls?: number;
}): React.ReactElement | null {
  const described = describeExecutionStatus(status, attention, deniedToolCalls);
  // A running row already has its spinner; no text tag repeats that.
  if (!described || described.label === 'Running') return null;
  return (
    <span className={`flex-shrink-0 rounded-md px-1.5 py-px text-[12px] ${STATUS_TAG_TONE[described.tone]}`}>
      {described.label}
    </span>
  );
}
