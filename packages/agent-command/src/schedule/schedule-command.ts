/**
 * FLOW-005: `/schedule` and `/monitor` command executors — create agent-wake background tasks.
 */

import { parseScheduleSpec } from './schedule-spec-parser.js';

import type { IAgentJobHostContext } from '@robota-sdk/agent-framework';
import type { ICommandResult } from '@robota-sdk/agent-interface-transport';

const MAX_LABEL_LENGTH = 48;

function labelFor(prefix: string, instruction: string): string {
  const snippet = instruction.slice(0, MAX_LABEL_LENGTH);
  return `${prefix}: ${snippet}${instruction.length > MAX_LABEL_LENGTH ? '…' : ''}`;
}

export async function executeScheduleCommand(
  host: IAgentJobHostContext,
  args: string,
  now: number = Date.now(),
): Promise<ICommandResult> {
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
