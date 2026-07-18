/**
 * SELFHOST-002: the `/plan` slash command — explicit plan-mode (plan → review → approve → act).
 * Delegates to the framework-owned plan controller via the command host context; the phase machine
 * and the `setPermissionMode` application both live in agent-framework. The mutation block stays the
 * existing `plan` permission mode; approving flips to `acceptEdits` (edits auto-apply, shell stays
 * per-call confirmed).
 */

import type { ICommandHostContext } from '@robota-sdk/agent-framework';
import type { ICommandResult, IPlanArtifact } from '@robota-sdk/agent-interface-transport';

export const PLAN_COMMAND_DESCRIPTION =
  'Draft a reviewable plan, then approve it to unblock edits (plan → review → approve → act).';

const PLAN_COMMAND_USAGE =
  'Usage:\n  /plan <objective>   draft a plan for review (stays read-only until approved)\n' +
  '  /plan status         show the current plan and phase\n' +
  '  /plan approve        approve the plan (edits auto-apply; shell stays confirmed)\n' +
  '  /plan revert         return to drafting (re-blocks edits)';

function formatPlan(plan: IPlanArtifact): string {
  const lines = [
    `Plan: ${plan.objective}`,
    `Phase: ${plan.phase}${plan.approvedAt ? ` (approved ${plan.approvedAt})` : ''}`,
  ];
  plan.steps.forEach((step, index) => {
    lines.push(`  ${index + 1}. [${step.status}] ${step.description}`);
  });
  return lines.join('\n');
}

export async function executePlanCommand(
  context: ICommandHostContext,
  args: string,
): Promise<ICommandResult> {
  const trimmed = args.trim();
  const verb = trimmed.split(/\s+/)[0]?.toLowerCase() ?? '';

  if (trimmed.length === 0 || verb === 'help') {
    return { message: PLAN_COMMAND_USAGE, success: true };
  }

  if (verb === 'status') {
    const plan = context.getPlanState?.() ?? null;
    return plan
      ? { message: formatPlan(plan), success: true, data: { phase: plan.phase } }
      : { message: 'No plan is active.', success: true };
  }

  if (verb === 'approve') {
    if (!context.approvePlan) {
      return { message: 'Plan mode is not available in this session.', success: false };
    }
    if (!(context.getPlanState?.() ?? null)) {
      return { message: 'No plan to approve. Start one with /plan <objective>.', success: false };
    }
    try {
      const plan = context.approvePlan();
      return {
        message: `Plan approved — edits will auto-apply; shell steps stay confirmed.\nPhase: ${plan.phase}`,
        success: true,
        data: { phase: plan.phase },
      };
    } catch (error) {
      // allow-fallback: an out-of-phase approval surfaces as a failed command, not a crash
      return { message: error instanceof Error ? error.message : String(error), success: false };
    }
  }

  if (verb === 'revert') {
    if (!context.revertPlan) {
      return { message: 'Plan mode is not available in this session.', success: false };
    }
    if (!(context.getPlanState?.() ?? null)) {
      return { message: 'No plan to revert.', success: false };
    }
    const plan = context.revertPlan();
    return {
      message: `Reverted to drafting — edits are blocked again (plan mode).\nPhase: ${plan.phase}`,
      success: true,
      data: { phase: plan.phase },
    };
  }

  if (!context.setPlan) {
    return { message: 'Plan mode is not available in this session.', success: false };
  }
  let plan: IPlanArtifact;
  try {
    plan = await context.setPlan(trimmed);
  } catch (error) {
    // allow-fallback: surface an invalid-objective error as a failed command result, not a crash
    return { message: error instanceof Error ? error.message : String(error), success: false };
  }
  return {
    message: `Plan drafted (read-only until approved). Review it, then run /plan approve:\n${plan.objective}`,
    success: true,
    data: { planId: plan.id },
  };
}
