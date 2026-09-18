/**
 * `robota doctor` / `checkup` / `diagnose` — the shell route over the `agent-command` doctor runner
 * (OBSERVABILITY-1991).
 *
 * Reachable without a working session: matched in `runPreparsedCliCommand` BEFORE the route's shared
 * workspace composition and before the strict global parser, so a broken configuration cannot make
 * the diagnostic unreachable and `--repair <check-id>` / `--yes` are never rejected as unknown
 * options. The shell owns exactly what only it knows — the composition it would have built (inside
 * this route's own failure boundary), the host-only checks (Node version, CLI version, terminal),
 * and how to render and confirm on a TTY. Everything else is the runner's.
 */
import { createInterface } from 'node:readline';

import {
  applyDoctorRepair,
  createNodeDoctorDeps,
  renderDoctorReport,
  runDoctor,
} from '@robota-sdk/agent-command';
import { createDefaultProviderDefinitions } from '@robota-sdk/agent-builtin-providers';

import { buildDoctorInputs, resolveDoctorProjectAccess } from './doctor-inputs.js';

import type { IStartCliOptions } from './command-setup.js';
import type { IDoctorRepairPlan } from '@robota-sdk/agent-command';
import type { ITerminalOutput } from '@robota-sdk/agent-core';

const DOCTOR_COMMAND_NAMES = ['doctor', 'checkup', 'diagnose'] as const;

export function isDoctorCommandName(name: string | undefined): boolean {
  return name !== undefined && (DOCTOR_COMMAND_NAMES as readonly string[]).includes(name);
}

export interface IDoctorRouteArgs {
  readonly repair?: string;
  readonly yes: boolean;
  readonly error?: string;
}

/** The route's own flags: `--repair <check-id>` and `--yes`/`-y`. Anything else is an error. */
export function parseDoctorRouteArgs(args: readonly string[]): IDoctorRouteArgs {
  let repair: string | undefined;
  let yes = false;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!;
    if (arg === '--yes' || arg === '-y') {
      yes = true;
    } else if (arg === '--repair') {
      const value = args[index + 1];
      if (value === undefined || value.startsWith('-')) {
        return { yes, error: '--repair requires a <check-id>' };
      }
      repair = value;
      index += 1;
    } else if (arg.startsWith('--repair=')) {
      repair = arg.slice('--repair='.length);
    } else {
      return {
        yes,
        error: `Unknown option '${arg}' for robota doctor (accepted: --repair <check-id>, --yes)`,
      };
    }
  }
  return { ...(repair === undefined ? {} : { repair }), yes };
}

export interface IDoctorRouteContext {
  readonly version: string;
  readonly terminal: ITerminalOutput;
  readonly cwd: string;
  readonly options: IStartCliOptions;
  readonly isTTY: boolean;
  readonly env?: Readonly<Record<string, string | undefined>>;
  /** Test seam; defaults to the platform home directory. */
  readonly userHome?: string;
}

async function confirmOnTty(plan: IDoctorRepairPlan): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await new Promise<string>((resolve) =>
      rl.question(`Repair ${plan.id} — ${plan.description} (${plan.path})? [y/N] `, resolve),
    );
    return /^y(es)?$/i.test(answer.trim());
  } finally {
    rl.close();
  }
}

/** Run the doctor (and, when asked, one repair). Returns the process exit code. */
export async function runDoctorRoute(
  ctx: IDoctorRouteContext,
  args: readonly string[],
  commandName: string = 'doctor',
): Promise<number> {
  const parsed = parseDoctorRouteArgs(args);
  if (parsed.error !== undefined) {
    ctx.terminal.writeError(parsed.error);
    return 1;
  }
  const env = ctx.env ?? process.env;
  const access = await resolveDoctorProjectAccess(ctx.cwd, ctx.options);
  const inputs = buildDoctorInputs({
    cwd: ctx.cwd,
    version: ctx.version,
    options: ctx.options,
    ...access,
    providerDefinitions: ctx.options.providerDefinitions ?? createDefaultProviderDefinitions(),
    env,
    ...(ctx.userHome === undefined ? {} : { userHome: ctx.userHome }),
  });
  const deps = createNodeDoctorDeps(env);

  if (parsed.repair !== undefined) {
    if (!ctx.isTTY && !parsed.yes) {
      ctx.terminal.writeError(
        `--repair ${parsed.repair} needs confirmation: pass --yes in a non-interactive shell.`,
      );
      return 1;
    }
    const outcome = await applyDoctorRepair(
      parsed.repair,
      inputs,
      deps,
      parsed.yes ? async () => true : confirmOnTty,
    );
    if (!outcome.applied) {
      ctx.terminal.writeError(outcome.reason);
      return 1;
    }
    ctx.terminal.writeLine(`Repaired ${outcome.plan.id}: ${outcome.plan.description}.`);
  }

  const report = await runDoctor(inputs, deps);
  for (const line of renderDoctorReport(report, `robota ${commandName}`))
    ctx.terminal.writeLine(line);
  return report.exitCode;
}
