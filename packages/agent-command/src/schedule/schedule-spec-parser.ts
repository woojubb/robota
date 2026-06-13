/**
 * FLOW-005: parse the `<when>` portion of `/schedule` into a cron expression croner accepts.
 *
 * Two forms:
 *   in <N><unit> <instruction>     — one-shot, fires once at now + duration (s|m|h|d)
 *   cron "<expr>" <instruction>    — recurring, a standard cron expression
 */

export interface IScheduleSpec {
  cronExpression: string;
  instruction: string;
  recurring: boolean;
}

export type TScheduleParseResult = { ok: true; spec: IScheduleSpec } | { ok: false; error: string };

const DURATION_MS: Record<string, number> = {
  s: 1_000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
};

const USAGE =
  'Usage: /schedule in <N><s|m|h|d> <instruction>  |  /schedule cron "<expr>" <instruction>';

export function parseScheduleSpec(args: string, now: number): TScheduleParseResult {
  const trimmed = args.trim();
  if (trimmed.length === 0) return { ok: false, error: USAGE };

  if (trimmed.startsWith('in ')) {
    const rest = trimmed.slice(3).trim();
    const spaceIdx = rest.indexOf(' ');
    if (spaceIdx === -1) return { ok: false, error: `Missing instruction. ${USAGE}` };
    const durationToken = rest.slice(0, spaceIdx);
    const instruction = rest.slice(spaceIdx + 1).trim();
    const match = /^(\d+)(s|m|h|d)$/.exec(durationToken);
    if (!match) return { ok: false, error: `Invalid duration "${durationToken}". ${USAGE}` };
    if (instruction.length === 0) return { ok: false, error: `Missing instruction. ${USAGE}` };
    const ms = parseInt(match[1]!, 10) * DURATION_MS[match[2]!]!;
    return {
      ok: true,
      spec: {
        cronExpression: new Date(now + ms).toISOString(),
        instruction,
        recurring: false,
      },
    };
  }

  if (trimmed.startsWith('cron ')) {
    const rest = trimmed.slice(5).trim();
    const quoted = /^["']([^"']+)["']\s+(.+)$/.exec(rest);
    if (!quoted) {
      return { ok: false, error: `cron form needs a quoted expression. ${USAGE}` };
    }
    const instruction = quoted[2]!.trim();
    if (instruction.length === 0) return { ok: false, error: `Missing instruction. ${USAGE}` };
    return {
      ok: true,
      spec: { cronExpression: quoted[1]!.trim(), instruction, recurring: true },
    };
  }

  return { ok: false, error: USAGE };
}
