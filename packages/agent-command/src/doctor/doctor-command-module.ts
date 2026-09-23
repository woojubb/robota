/**
 * `/doctor` — the interactive surface of the same runner the shell route uses (OBSERVABILITY-1991).
 *
 * `/doctor` renders the report; `/doctor repair <check-id>` confirms through the host's user
 * interaction port and treats an absent port or a cancelled answer as "nothing written". Neither
 * form creates a provider turn or submits user input: the command reads and, on explicit
 * confirmation, runs one allowlisted writer.
 */
import { confirmAction } from '@robota-sdk/agent-core';

import { createNodeDoctorDeps } from './doctor-node-deps.js';
import { renderDoctorReport } from './doctor-render.js';
import { applyDoctorRepair } from './doctor-repair.js';
import { runDoctor } from './doctor-runner.js';

import type { IDoctorRepairPlan } from './doctor-repair.js';
import type { IDoctorDeps, IDoctorInputs } from './doctor-types.js';
import type {
  ICommandHostUserInteraction,
  ICommandModule,
  ISystemCommand,
} from '@robota-sdk/agent-framework';
import type { ICommand, ICommandResult, ICommandSource } from '@robota-sdk/agent-interface-command';

export function createDoctorCommandEntry(): ICommand {
  return {
    name: 'doctor',
    displayName: 'Doctor',
    description:
      'Diagnose configuration and runtime readiness; `repair <check-id>` applies an allowlisted fix',
    source: 'doctor',
    modelInvocable: false,
  };
}

export class DoctorCommandSource implements ICommandSource {
  readonly name = 'doctor';

  getCommands(): ICommand[] {
    return [createDoctorCommandEntry()];
  }
}

async function confirmThroughHost(
  context: ICommandHostUserInteraction,
  plan: IDoctorRepairPlan,
): Promise<boolean> {
  const ui = context.getUserInteraction();
  if (ui === undefined) return false;
  const response = await ui.ask(
    confirmAction(`doctor-repair:${plan.id}`, `Repair ${plan.id}?`, {
      description: `${plan.description} (${plan.path})`,
      defaultYes: false,
    }),
  );
  return response.type === 'answer' && response.values[0] === 'yes';
}

async function executeRepair(
  id: string,
  inputs: IDoctorInputs,
  deps: IDoctorDeps,
  context: ICommandHostUserInteraction,
): Promise<ICommandResult> {
  const outcome = await applyDoctorRepair(id, inputs, deps, (plan) =>
    confirmThroughHost(context, plan),
  );
  if (!outcome.applied) {
    return { success: false, message: outcome.reason, data: { repair: id, applied: false } };
  }
  const report = await runDoctor(inputs, deps);
  const check = report.checks.find((candidate) => candidate.id === id);
  return {
    success: true,
    message: [
      `Repaired ${id}: ${outcome.plan.description}.`,
      ...renderDoctorReport(report, 'robota doctor (after repair)'),
    ].join('\n'),
    data: { repair: id, applied: true, status: check?.status, exitCode: report.exitCode },
  };
}

async function executeDoctorCommand(
  inputs: IDoctorInputs,
  deps: IDoctorDeps,
  context: ICommandHostUserInteraction,
  args: string,
): Promise<ICommandResult> {
  const [verb, target] = args.trim().split(/\s+/);
  if (verb === 'repair') {
    if (target === undefined || target.length === 0) {
      return { success: false, message: 'Usage: /doctor repair <check-id>' };
    }
    return executeRepair(target, inputs, deps, context);
  }
  const report = await runDoctor(inputs, deps);
  return {
    success: report.failCount === 0,
    message: renderDoctorReport(report).join('\n'),
    data: {
      failCount: report.failCount,
      warnCount: report.warnCount,
      repairable: [...report.repairable],
    },
  };
}

/** Register `/doctor` over the host-composed inputs; the host decides whether to supply them. */
export function createDoctorCommandModule(
  inputs: IDoctorInputs,
  deps: IDoctorDeps = createNodeDoctorDeps({ ...inputs.env }),
): ICommandModule {
  const entry = createDoctorCommandEntry();
  const command: ISystemCommand = {
    name: entry.name,
    displayName: entry.displayName,
    description: entry.description,
    argumentHint: '[repair <check-id>]',
    requiresPermission: false,
    userInvocable: true,
    modelInvocable: false,
    lifecycle: 'inline',
    execute: (context, args) => executeDoctorCommand(inputs, deps, context, args),
  };
  return {
    name: 'agent-command-doctor',
    commandSources: [new DoctorCommandSource()],
    systemCommands: [command],
  };
}
