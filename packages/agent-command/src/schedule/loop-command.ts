/** Fixed or self-paced session-local repetition. */

import { randomUUID } from 'node:crypto';

import { jitterFixedLoop } from './loop-jitter.js';

import type { IAgentJobHostContext } from '@robota-sdk/agent-framework';
import type { ICommandResult } from '@robota-sdk/agent-interface-command';
import type { IBackgroundTaskState } from '@robota-sdk/agent-interface-execution';

const LOOP_LABEL = 'Loop: ';
const SECONDS_PER_MINUTE = 60;
const HOURS_PER_DAY = 24;
const MAX_LABEL_LENGTH = 48;
const MAX_ACTIVE_LOOPS = 3;
const LOOP_LIFETIME_MS = 7 * 24 * 60 * 60_000;
const MAX_DEFAULT_PROMPT_LENGTH = 4_096;
const pendingCreates = new WeakMap<object, number>();
const TRAILING_UNITS = new Set([
  'second', 'seconds', 'minute', 'minutes', 'hour', 'hours', 'day', 'days', 's', 'm', 'h', 'd',
]);
const USAGE =
  'Usage: /loop [<prompt>] | /loop <N><s|m|h|d> [<prompt>] | /loop <prompt> every <N> <unit> | /loop list | /loop stop <id>. Bare and interval-only forms require a host maintenance prompt.';

export interface ILoopCommandOptions {
  /** Product-host-owned maintenance text, used only when the operator omits a prompt. */
  defaultPrompt?: string;
  /** Re-read the project/user default for each new loop; an explicit prompt never calls this. */
  resolveDefaultPrompt?: () => string;
  /** Host kill switch; listing and stopping existing loops remain available. */
  disabled?: boolean;
}

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

function parseTrailingInterval(args: string): { instruction: string; amount: string; unit: string } | undefined {
  let cursor = args.length;
  while (cursor > 0 && /[a-z]/i.test(args[cursor - 1]!)) cursor -= 1;
  const unit = args.slice(cursor).toLowerCase();
  if (!TRAILING_UNITS.has(unit)) return undefined;
  while (cursor > 0 && /\s/u.test(args[cursor - 1]!)) cursor -= 1;
  const amountEnd = cursor;
  while (cursor > 0 && args.charCodeAt(cursor - 1) >= 48 && args.charCodeAt(cursor - 1) <= 57) cursor -= 1;
  if (cursor === amountEnd) return undefined;
  const amount = args.slice(cursor, amountEnd);
  const spaceAfterEvery = cursor;
  while (cursor > 0 && /\s/u.test(args[cursor - 1]!)) cursor -= 1;
  if (cursor === spaceAfterEvery || args.slice(cursor - 5, cursor).toLowerCase() !== 'every') return undefined;
  cursor -= 5;
  const spaceBeforeEvery = cursor;
  while (cursor > 0 && /\s/u.test(args[cursor - 1]!)) cursor -= 1;
  if (cursor === spaceBeforeEvery) return undefined;
  const instruction = args.slice(0, cursor).trim();
  return instruction ? { instruction, amount, unit } : undefined;
}

function parseCreate(
  args: string,
  defaultPrompt: string | undefined,
): { instruction: string; requestedMs: number } | undefined {
  const boundedDefault =
    defaultPrompt && defaultPrompt.length <= MAX_DEFAULT_PROMPT_LENGTH
      ? defaultPrompt.trim()
      : undefined;
  if (args === '') return undefined;
  const intervalOnly = /^(\d+)(s|m|h|d)$/i.exec(args);
  if (intervalOnly && boundedDefault) {
    const requestedMs = parseDuration(intervalOnly[1]!, intervalOnly[2]!.toLowerCase());
    return requestedMs === undefined ? undefined : { instruction: boundedDefault, requestedMs };
  }
  // One required space, then the rest verbatim (trimmed below): `\s+` before `[\s\S]+` split the
  // same spaces two ways, which CodeQL reads as polynomial backtracking.
  const leading = /^(\d+)(s|m|h|d)\s([\s\S]+)$/i.exec(args);
  if (leading) {
    const instruction = leading[3]!.trim();
    const requestedMs = parseDuration(leading[1]!, leading[2]!.toLowerCase());
    if (instruction && requestedMs !== undefined && !parseTrailingInterval(instruction)) {
      return { instruction, requestedMs };
    }
    return undefined;
  }

  const trailing = parseTrailingInterval(args);
  if (!trailing) return undefined;
  const requestedMs = parseDuration(trailing.amount, trailing.unit[0]!);
  return requestedMs !== undefined ? { instruction: trailing.instruction, requestedMs } : undefined;
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
        task.metadata?.['sessionLoopSelfPaced'] !== true &&
        task.status !== 'cancelled' &&
        task.status !== 'completed' &&
        task.status !== 'failed',
    );
}

function activeSelfPacedLoops(host: Pick<IAgentJobHostContext, 'listSelfPacedLoops'>) {
  return (host.listSelfPacedLoops?.() ?? []).filter(
    (loop) => loop.phase !== 'stopped' && loop.phase !== 'expired',
  );
}

function loopIdOf(task: IBackgroundTaskState): string {
  const id = task.metadata?.['sessionLoopId'];
  // Loops created before stable ids were introduced keep their runtime id as the stop handle.
  return typeof id === 'string' && id.length > 0 ? id : task.id;
}

export async function executeLoopCommand(
  host: Pick<IAgentJobHostContext, 'spawnScheduledWake' | 'listSchedules' | 'createSelfPacedLoop' | 'listSelfPacedLoops' | 'stopSelfPacedLoop'>,
  cancelBackgroundTask: (taskId: string, reason: string) => Promise<void>,
  args: string,
  options: ILoopCommandOptions = {},
): Promise<ICommandResult> {
  const trimmed = args.trim();
  if (trimmed === 'list') return listLoops(host, options);
  if (/^stop(?:\s|$)/.test(trimmed)) return stopLoop(host, cancelBackgroundTask, trimmed);

  if (options.disabled) {
    return { success: false, message: 'Session loops are disabled by the host.' };
  }
  return createLoop(host, trimmed, options);
}

function listLoops(
  host: Pick<IAgentJobHostContext, 'listSchedules' | 'listSelfPacedLoops'>,
  options: ILoopCommandOptions,
): ICommandResult {
  const loops = activeLoops(host);
  const selfPaced = activeSelfPacedLoops(host);
  const header = options.disabled ? 'Session loops are disabled by the host.\n' : '';
  return {
    success: true,
    message:
      header +
      (loops.length + selfPaced.length === 0
        ? 'No active loops.'
        : [
            ...loops.map((task) => `- ${loopIdOf(task)} [${task.status}] ${task.label}`),
            ...selfPaced.map((loop) =>
              `- ${loop.loopId} [${loop.phase}] Loop: ${loop.instruction}` +
              (loop.phase === 'waiting' && loop.delaySeconds !== undefined && loop.reason
                ? ` — next ${loop.delaySeconds}s: ${loop.reason}`
                : ''),
            ),
          ].join('\n')),
    data: { count: loops.length + selfPaced.length },
  };
}

async function stopLoop(
  host: Pick<IAgentJobHostContext, 'listSchedules' | 'listSelfPacedLoops' | 'stopSelfPacedLoop'>,
  cancelBackgroundTask: (taskId: string, reason: string) => Promise<void>,
  args: string,
): Promise<ICommandResult> {
  const match = /^stop\s+(\S+)$/.exec(args);
  if (!match) return { success: false, message: USAGE };
  const selfPaced = activeSelfPacedLoops(host).find((loop) => loop.loopId === match[1]);
  if (selfPaced) {
    if (!host.stopSelfPacedLoop) return { success: false, message: 'This host cannot stop self-paced loops.' };
    await host.stopSelfPacedLoop(selfPaced.loopId, 'Loop stopped by user');
    return {
      success: true,
      message: `Loop stopped: ${selfPaced.loopId}. An already-running turn may finish.`,
      data: { loopId: selfPaced.loopId },
    };
  }
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
  host: Pick<IAgentJobHostContext, 'spawnScheduledWake' | 'listSchedules' | 'createSelfPacedLoop' | 'listSelfPacedLoops'>,
  args: string,
  options: ILoopCommandOptions,
): Promise<ICommandResult> {
  const useDefaultPrompt = args === '' || /^\d+(s|m|h|d)$/i.test(args);
  let defaultPrompt = options.defaultPrompt;
  if (useDefaultPrompt && options.resolveDefaultPrompt) {
    try {
      defaultPrompt = options.resolveDefaultPrompt();
    } catch (error) {
      return { success: false, message: `Default loop prompt could not be loaded: ${error instanceof Error ? error.message : String(error)}` };
    }
  }
  const parsed = parseCreate(args, defaultPrompt);
  if (!parsed) {
    if (/^\d+[a-z](?:\s|$)/i.test(args) || parseTrailingInterval(args)) {
      return { success: false, message: USAGE };
    }
    const instruction = (args || defaultPrompt || '').trim();
    if (!instruction || (args === '' && instruction.length > MAX_DEFAULT_PROMPT_LENGTH)) {
      return { success: false, message: USAGE };
    }
    if (!host.createSelfPacedLoop) {
      return { success: false, message: 'Self-paced loops require a persistent interactive session.' };
    }
    const pending = pendingCreates.get(host) ?? 0;
    if (activeLoops(host).length + activeSelfPacedLoops(host).length + pending >= MAX_ACTIVE_LOOPS) {
      return { success: false, message: `At most ${MAX_ACTIVE_LOOPS} active loops are allowed. Stop one before creating another.` };
    }
    pendingCreates.set(host, pending + 1);
    try {
      const loop = useDefaultPrompt
        ? await host.createSelfPacedLoop(instruction, { useDefaultPrompt: true })
        : await host.createSelfPacedLoop(instruction);
      return {
        success: true,
        message: `Self-paced loop ${loop.loopId} started. It will choose a 1–60 minute delay after each iteration and expires ${loop.expiresAt}. Stop with /loop stop ${loop.loopId}.`,
        data: { loopId: loop.loopId, expiresAt: loop.expiresAt },
      };
    } finally {
      const remaining = (pendingCreates.get(host) ?? 1) - 1;
      if (remaining === 0) pendingCreates.delete(host);
      else pendingCreates.set(host, remaining);
    }
  }
  const pending = pendingCreates.get(host) ?? 0;
  if (activeLoops(host).length + activeSelfPacedLoops(host).length + pending >= MAX_ACTIVE_LOOPS) {
    return {
      success: false,
      message: `At most ${MAX_ACTIVE_LOOPS} active loops are allowed. Stop one before creating another.`,
    };
  }
  const cadence = chooseCadence(parsed.requestedMs);
  const label = `${LOOP_LABEL}${parsed.instruction.slice(0, MAX_LABEL_LENGTH)}`;
  const loopId = `loop_${randomUUID()}`;
  const jitter = jitterFixedLoop(loopId, cadence);
  const nowMs = Date.now();
  const firstAllowedAt = new Date(nowMs + parsed.requestedMs).toISOString();
  const expiresAt = new Date(nowMs + LOOP_LIFETIME_MS).toISOString();
  pendingCreates.set(host, pending + 1);
  let task: IBackgroundTaskState;
  try {
    task = await host.spawnScheduledWake({
      label,
      cronExpression: jitter.cronExpression,
      agentInstruction: parsed.instruction,
      sessionLoop: true,
      sessionLoopId: loopId,
      ...(useDefaultPrompt ? { sessionLoopDefaultPrompt: true } : {}),
      sessionLoopFirstAllowedAt: firstAllowedAt,
      sessionLoopExpiresAt: expiresAt,
    });
  } finally {
    const remaining = (pendingCreates.get(host) ?? 1) - 1;
    if (remaining === 0) pendingCreates.delete(host);
    else pendingCreates.set(host, remaining);
  }
  const rounded = cadence.milliseconds !== parsed.requestedMs ? ' (rounded up)' : '';
  // `spawnScheduledWake` always spawns a scheduled-kind task; the kind check lets TypeScript
  // narrow to the member that carries `nextFireAt` (#2079).
  const nextFire =
    task.kind === 'scheduled' && task.nextFireAt && task.nextFireAt >= firstAllowedAt
      ? ` Next fire: ${task.nextFireAt}.`
      : '';
  return {
    success: true,
    message: `Loop ${loopId} uses a ${cadence.description}${rounded} local-clock step with stable offset +${jitter.jitterSeconds}s; elapsed gaps can change with daylight saving. First eligible at or after ${firstAllowedAt}.${nextFire} Expires: ${expiresAt}. Stop with /loop stop ${loopId}.`,
    data: {
      loopId,
      taskId: task.id,
      requestedMs: parsed.requestedMs,
      cadenceLabel: cadence.description,
      cronExpression: jitter.cronExpression,
      jitterSeconds: jitter.jitterSeconds,
      firstAllowedAt,
      expiresAt,
    },
  };
}
