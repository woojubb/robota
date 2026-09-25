/**
 * Where robota runs a session's commands, named in one place (issue #3081).
 *
 * The composition root passes this to the pack set, and `robota doctor` reports it, so the doctor
 * answers from the same value the session is built with instead of restating it. Robota composes no
 * sandbox client today: every command runs on the host, under the permission rules and prompts
 * alone. Sandbox backends are selected here when they exist.
 */
import { describeExecutionContainment } from '@robota-sdk/agent-tools';

import type { IDoctorCheck } from '@robota-sdk/agent-command';
import type { ISandboxClient } from '@robota-sdk/agent-tools';

export function robotaSandboxClient(): ISandboxClient | undefined {
  return undefined;
}

export function checkExecutionContainment(
  sandboxClient: ISandboxClient | undefined = robotaSandboxClient(),
): IDoctorCheck {
  const containment = describeExecutionContainment(sandboxClient);
  if (containment === 'host') {
    return {
      id: 'execution.containment',
      label: 'Command containment',
      status: 'ok',
      cause: 'host',
      detail: [
        'Shell commands run directly on this machine, unconfined.',
        'Permission rules and prompts are the only boundary.',
      ],
    };
  }
  return {
    id: 'execution.containment',
    label: 'Command containment',
    status: 'ok',
    cause: containment,
  };
}
