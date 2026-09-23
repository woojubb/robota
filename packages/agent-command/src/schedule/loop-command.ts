/** A fixed-cadence, session-local repeat built on the existing scheduled-wake path. */

import { randomUUID } from 'node:crypto';

import type { IAgentJobHostContext } from '@robota-sdk/agent-framework';
import type { ICommandResult } from '@robota-sdk/agent-interface-command';
import type { IBackgroundTaskState } from '@robota-sdk/agent-interface-execution';

const LOOP_LABEL = 'Loop: ';
const SECONDS_PER_MINUTE = 60;
const HOURS_PER_DAY = 24;
const MAX_LABEL_LENGTH = 48;
const MAX_ACTIVE_LOOPS = 3;
const TRAILING_INTERVAL =
  /^([\s\S]+?)\s+every\s+(\d+)\s*(seconds?|minutes?|hours?|days?|s|m|h|d)$/i;
const USAGE =
  'Usage: /loop <N><s|m|h|d> <prompt> | /loop <prompt> every <N> <seconds|minutes|hours|days> | /loop list | /loop stop <id>. Fixed intervals up to one day are supported.';

const UNIT_MS: Record<string, number> = {
  s: 1_000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
};

interface ILoopCadence {
  cronExpression: string;
  milliseconds: number;
  description: string;
}

const CADENCES: ILoopCadence[] = [
  ...divisors(SECONDS_PER_MINUTE).map((n) => ({
    cronExpression: n === SECONDS_PER_MINUTE ? '0 * * * * *' : `*/${n} * * * * *`,
    milliseconds: n * UNIT_MS.s!,
    description: `${n}s`,
  })),
  ...divisors(SECONDS_PER_MINUTE)
    .filter((n) => n > 1)
    .map((n) => ({
      cronExpression: n === SECONDS_PER_MINUTE ? '0 0 * * * *' : `0 */${n} * * * *`,
      milliseconds: n * UNIT_MS.m!,
      description: `${n}m`,
    })),
  ...divisors(HOURS_PER_DAY)
    .filter((n) => n > 1)
    .map((n) => ({
      cronExpression: n === HOURS_PER_DAY ? '0 0 0 * * *' : `0 0 */${n} * * *`,
      milliseconds: n * UNIT_MS.h!,
      description: `${n}h`,
    })),
];

function divisors(maximum: number): number[] {
  return Array.from({ length: maximum }, (_, index) => index + 1).filter(
    (value) => maximum % value === 0,
  );
}

function parseDuration(amountText: string, unit: string): number | undefined {
  const amount = Number(amountText);
  const multiplier = UNIT_MS[unit];
  if (!Number.isSafeInteger(amount) || amount <= 0 || multiplier === undefined) return undefined;
  const milliseconds = amount * multiplier;
  return Number.isSafeInteger(milliseconds) && milliseconds <= UNIT_MS.d ? milliseconds : undefined;
}

function parseCreate(args: string): { instruction: string; requestedMs: number } | undefined {
  const leading = /^(\d+)(s|m|h|d)\s+([\s\S]+)$/i.exec(args);
  if (leading) {
    const instruction = leading[3]!.trim();
    const requestedMs = parseDuration(leading[1]!, leading[2]!.toLowerCase());
    if (instruction && requestedMs !== undefined && !TRAILING_INTERVAL.test(instruction)) {
      return { instruction, requestedMs };
    }
    return undefined;
  }

  const trailing = TRAILING_INTERVAL.exec(args);
  if (!trailing) return undefined;
  const instruction = trailing[1]!.trim();
  const unit = trailing[3]!.toLowerCase();
  const requestedMs = parseDuration(trailing[2]!, unit[0]!);
  return instruction && requestedMs !== undefined ? { instruction, requestedMs } : undefined;
}

function chooseCadence(requestedMs: number): ILoopCadence {
  // Calendar-aligned cron steps cannot express every duration. Choose the first step that is
  // never more frequent than requested, and report the normalization to the caller.
  return CADENCES.find((cadence) => cadence.milliseconds >= requestedMs)!;
}

function activeLoops(host: Pick<IAgentJobHostContext, 'listSchedules'>): IBackgroundTaskState[] {
  return host
    .listSchedules()
    .filter(
      (task) =>
        task.metadata?.['sessionLoop'] === true &&
        task.status !== 'cancelled' &&
        task.status !== 'completed' &&
        task.status !== 'failed',
    );
}

function loopIdOf(task: IBackgroundTaskState): string {
  const id = task.metadata?.['sessionLoopId'];
  // Loops created before stable ids were introduced keep their runtime id as the stop handle.
  return typeof id === 'string' && id.length > 0 ? id : task.id;
}

export async function executeLoopCommand(
  host: Pick<IAgentJobHostContext, 'spawnScheduledWake' | 'listSchedules'>,
  cancelBackgroundTask: (taskId: string, reason: string) => Promise<void>,
  args: string,
): Promise<ICommandResult> {
  const trimmed = args.trim();
  if (trimmed === 'list') return listLoops(host);
  if (/^stop(?:\s|$)/.test(trimmed)) return stopLoop(host, cancelBackgroundTask, trimmed);

  return createLoop(host, trimmed);
}

function listLoops(host: Pick<IAgentJobHostContext, 'listSchedules'>): ICommandResult {
  const loops = activeLoops(host);
  return {
    success: true,
    message:
      loops.length === 0
        ? 'No active loops.'
        : loops.map((task) => `- ${loopIdOf(task)} [${task.status}] ${task.label}`).join('\n'),
    data: { count: loops.length },
  };
}

async function stopLoop(
  host: Pick<IAgentJobHostContext, 'listSchedules'>,
  cancelBackgroundTask: (taskId: string, reason: string) => Promise<void>,
  args: string,
): Promise<ICommandResult> {
  const match = /^stop\s+(\S+)$/.exec(args);
  if (!match) return { success: false, message: USAGE };
  const task = activeLoops(host).find((candidate) => loopIdOf(candidate) === match[1]);
  if (!task) return { success: false, message: `Active loop not found: ${match[1]}` };
  await cancelBackgroundTask(task.id, 'Loop stopped by user');
  return {
    success: true,
    message: `Loop stopped: ${loopIdOf(task)}. An already-running turn may finish.`,
    data: { loopId: loopIdOf(task), taskId: task.id },
  };
}

async function createLoop(
  host: Pick<IAgentJobHostContext, 'spawnScheduledWake' | 'listSchedules'>,
  args: string,
): Promise<ICommandResult> {
  const parsed = parseCreate(args);
  if (!parsed) return { success: false, message: USAGE };
  if (activeLoops(host).length >= MAX_ACTIVE_LOOPS) {
    return {
      success: false,
      message: `At most ${MAX_ACTIVE_LOOPS} active loops are allowed. Stop one before creating another.`,
    };
  }
  const cadence = chooseCadence(parsed.requestedMs);
  const label = `${LOOP_LABEL}${parsed.instruction.slice(0, MAX_LABEL_LENGTH)}`;
  const loopId = `loop_${randomUUID()}`;
  const task = await host.spawnScheduledWake({
    label,
    cronExpression: cadence.cronExpression,
    agentInstruction: parsed.instruction,
    sessionLoop: true,
    sessionLoopId: loopId,
  });
  const rounded = cadence.milliseconds !== parsed.requestedMs ? ' (rounded up)' : '';
  const nextFire = task.nextFireAt ? ` Next fire: ${task.nextFireAt}.` : '';
  return {
    success: true,
    message: `Loop ${loopId} uses a ${cadence.description}${rounded} local-clock step; elapsed gaps can change with daylight saving.${nextFire} Stop with /loop stop ${loopId}.`,
    data: {
      loopId,
      taskId: task.id,
      requestedMs: parsed.requestedMs,
      cadenceLabel: cadence.description,
      cronExpression: cadence.cronExpression,
    },
  };
}
