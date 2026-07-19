/**
 * FLOW-005: `/schedule` and `/monitor` command executors — create agent-wake background tasks.
 */

import { parseScheduleSpec } from './schedule-spec-parser.js';

import type { IAgentJobHostContext } from '@robota-sdk/agent-framework';
import type { IBackgroundTaskState, ICommandResult } from '@robota-sdk/agent-interface-transport';

const MAX_LABEL_LENGTH = 48;

function labelFor(prefix: string, instruction: string): string {
  const snippet = instruction.slice(0, MAX_LABEL_LENGTH);
  return `${prefix}: ${snippet}${instruction.length > MAX_LABEL_LENGTH ? '…' : ''}`;
}

// SELFHOST-012: management subcommands over the existing scheduler. Create (FLOW-005) stays the default form —
// a create spec always begins with `in`/`cron`, so these keywords never collide with it.
const MANAGE_USAGE =
  'Usage: /schedule list | pause <id> | resume <id> | edit <id> <spec>  (or a create spec: in <N><s|m|h|d> … | cron "<expr>" …)';

/** One-line list view: id, status, cadence, label, and next-fire (or `paused`). */
function formatScheduleList(schedules: IBackgroundTaskState[]): string {
  if (schedules.length === 0) return 'No schedules.';
  return schedules
    .map((s) => {
      const cadence = s.schedule?.cronExpression ?? '(unknown)';
      const when = s.status === 'paused' ? 'paused' : s.nextFireAt ? `next ${s.nextFireAt}` : '—';
      return `- ${s.id} [${s.status}] ${cadence} — ${s.label} (${when})`;
    })
    .join('\n');
}

async function executeScheduleManagement(
  host: IAgentJobHostContext,
  action: string,
  rest: string,
  now: number,
): Promise<ICommandResult | undefined> {
  if (action === 'list') {
    const schedules = host.listSchedules();
    return {
      message: formatScheduleList(schedules),
      success: true,
      data: { count: schedules.length },
    };
  }
  if (action === 'pause' || action === 'resume') {
    const id = rest.split(/\s+/)[0];
    if (!id) return { message: MANAGE_USAGE, success: false };
    if (action === 'pause') {
      await host.pauseSchedule(id);
      return { message: `Schedule paused: ${id}`, success: true, data: { taskId: id } };
    }
    await host.resumeSchedule(id);
    return { message: `Schedule resumed: ${id}`, success: true, data: { taskId: id } };
  }
  if (action === 'edit') {
    const idSpaceIdx = rest.indexOf(' ');
    const id = idSpaceIdx === -1 ? rest : rest.slice(0, idSpaceIdx);
    const spec = idSpaceIdx === -1 ? '' : rest.slice(idSpaceIdx + 1).trim();
    if (!id || !spec) return { message: MANAGE_USAGE, success: false };
    const parsed = parseScheduleSpec(spec, now);
    if (!parsed.ok) return { message: parsed.error, success: false };
    await host.editSchedule(id, {
      cronExpression: parsed.spec.cronExpression,
      agentInstruction: parsed.spec.instruction,
    });
    return {
      message: `Schedule updated: ${id} (cron \`${parsed.spec.cronExpression}\`).`,
      success: true,
      data: { taskId: id, cronExpression: parsed.spec.cronExpression },
    };
  }
  return undefined; // not a management subcommand — fall through to create
}

export async function executeScheduleCommand(
  host: IAgentJobHostContext,
  args: string,
  now: number = Date.now(),
): Promise<ICommandResult> {
  const trimmed = args.trim();
  const spaceIdx = trimmed.indexOf(' ');
  const action = (spaceIdx === -1 ? trimmed : trimmed.slice(0, spaceIdx)).toLowerCase();
  const rest = spaceIdx === -1 ? '' : trimmed.slice(spaceIdx + 1).trim();

  const managed = await executeScheduleManagement(host, action, rest, now);
  if (managed) return managed;

  // Default: create (FLOW-005 form).
  const parsed = parseScheduleSpec(args, now);
  if (!parsed.ok) return { message: parsed.error, success: false };

  const { cronExpression, instruction, recurring } = parsed.spec;
  const task = await host.spawnScheduledWake({
    label: labelFor('Scheduled', instruction),
    cronExpression,
    agentInstruction: instruction,
  });

  const when = recurring ? `cron \`${cronExpression}\`` : `once at ${cronExpression}`;
  return {
    message: `Scheduled wake (${when}): "${instruction}" — task ${task.id}.`,
    success: true,
    data: { taskId: task.id, cronExpression, recurring },
  };
}

const MONITOR_USAGE = 'Usage: /monitor "<command>" "<pattern>" <instruction>';

/** Parse `"<command>" "<pattern>" <instruction>` (quotes may be single or double). */
function parseMonitorArgs(
  args: string,
): { command: string; matchPattern: string; instruction: string } | null {
  const match = /^["']([^"']+)["']\s+["']([^"']+)["']\s+(.+)$/.exec(args.trim());
  if (!match) return null;
  const instruction = match[3]!.trim();
  if (instruction.length === 0) return null;
  return { command: match[1]!, matchPattern: match[2]!, instruction };
}

export async function executeMonitorCommand(
  host: IAgentJobHostContext,
  args: string,
): Promise<ICommandResult> {
  const parsed = parseMonitorArgs(args);
  if (!parsed) return { message: MONITOR_USAGE, success: false };

  const task = await host.spawnMonitorWake({
    label: labelFor('Monitor', parsed.instruction),
    command: parsed.command,
    matchPattern: parsed.matchPattern,
    agentInstruction: parsed.instruction,
  });

  return {
    message: `Monitoring \`${parsed.command}\` for /${parsed.matchPattern}/ — task ${task.id}.`,
    success: true,
    data: { taskId: task.id, matchPattern: parsed.matchPattern },
  };
}
