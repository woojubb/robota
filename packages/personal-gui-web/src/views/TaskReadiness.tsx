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

/** What the person does for one step, in plain words. The names in it are shown as the text they are. */
function stepText(step: TTaskSetupStepView): string {
  switch (step.type) {
    case 'connect':
      return `Connect ${SERVICE[step.kind]}`;
    case 'choose-account':
      return `Choose which account to use: ${step.accounts.map((account) => account.title).join(', ')}`;
    case 'allow-tool':
      return `Allow the tool ${step.tool} for ${step.connectorTitle}${
        step.decision === 'write' ? ' (each change still waits for your approval)' : ''
      }`;
    case 'reconnect':
      return `Reconnect ${step.connectorTitle}`;
  }
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
          <ul aria-label="Setup steps" className="list-disc pl-5">
            {readiness.steps.map((step) => (
              <li key={stepText(step)}>{stepText(step)}</li>
            ))}
          </ul>
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
