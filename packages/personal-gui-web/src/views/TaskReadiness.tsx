import type { TTaskReadinessView, TTaskSetupStepView } from '../api.js';

/** The chip every task and offer card carries beside its title. */
export const chip =
  'rounded-full border border-border px-2 py-0.5 text-[12px] font-medium text-muted-foreground';

export const READINESS = {
  ready: 'Ready',
  'needs-setup': 'Needs setup',
  unavailable: 'Unavailable',
} as const;

const SERVICE = {
  mail: 'a mail service',
  calendar: 'a calendar service',
  files: 'a file service',
  chat: 'a chat service',
  notes: 'a notes service',
  other: 'a service',
} as const;

/** A connector as the person is shown it: the title they gave it, and the id that tells two of the same title apart. */
export const accountLabel = (account: { readonly id: string; readonly title: string }): string =>
  `${account.title} (${account.id})`;

/** What identifies a step, so that two steps never share a key: by connector id, never by the words shown. */
export function stepKey(step: TTaskSetupStepView): string {
  switch (step.type) {
    case 'connect':
      return `connect:${step.kind}`;
    case 'choose-account':
      return `choose-account:${step.accounts.map((account) => account.id).join(',')}`;
    case 'allow-tool':
      return `allow-tool:${step.connectorId}:${step.tool}`;
    case 'reconnect':
      return `reconnect:${step.connectorId}`;
  }
}

/** What the person does for one step, in plain words. The names in it are shown as the text they are. */
function stepText(step: TTaskSetupStepView): string {
  switch (step.type) {
    case 'connect':
      return `Connect ${SERVICE[step.kind]}`;
    case 'choose-account':
      return `Choose which account to use: ${step.accounts.map(accountLabel).join(', ')}`;
    case 'allow-tool':
      return `Allow the tool ${step.tool} for ${accountLabel({ id: step.connectorId, title: step.connectorTitle })}${
        step.decision === 'write' ? ' (each change still waits for your approval)' : ''
      }`;
    case 'reconnect':
      return `Reconnect ${accountLabel({ id: step.connectorId, title: step.connectorTitle })}`;
  }
}

/** The setup steps a task still needs, as a list. */
export function SetupSteps({
  steps,
  label = 'Setup steps',
}: {
  readonly steps: readonly TTaskSetupStepView[];
  readonly label?: string;
}): React.ReactElement {
  return (
    <ul aria-label={label} className="list-disc pl-5">
      {steps.map((step) => (
        <li key={stepKey(step)}>{stepText(step)}</li>
      ))}
    </ul>
  );
}

/**
 * What the agent says about a task now, in its words: the access a ready task would use, the setup
 * steps a task still needs, or why it cannot run. A task card and an offer card say it the same way.
 */
export function Readiness({
  readiness,
}: {
  readonly readiness: TTaskReadinessView;
}): React.ReactElement | null {
  switch (readiness.state) {
    case 'unavailable':
      return <p className="mt-1 text-[12.5px] text-muted-foreground">{readiness.reason}</p>;
    case 'needs-setup':
      return (
        <div className="mt-1 text-[13px]">
          <p className="font-medium">To get this ready:</p>
          <SetupSteps steps={readiness.steps} />
        </div>
      );
    case 'ready':
      return (
        <div className="mt-1 text-[13px]">
          <p className="font-medium">Access</p>
          <ul aria-label="Access" className="list-disc pl-5">
            {readiness.accesses.map((access) => (
              <li key={access}>{access}</li>
            ))}
          </ul>
        </div>
      );
  }
}
