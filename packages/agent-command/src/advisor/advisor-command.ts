import type {
  IAdvisorStatus,
  ICommandHostAdapterAccess,
  ICommandHostWorkspace,
} from '@robota-sdk/agent-framework';
import type { ICommandResult } from '@robota-sdk/agent-interface-command';

/** The user-settings key `/advisor` saves the default advisor under. */
export const ADVISOR_SETTING_KEY = 'advisorModel';

function describeStatus(status: IAdvisorStatus): string {
  if (status.killSwitch) return 'Advisor: disabled by the environment kill switch.';
  if (status.target === undefined || !status.enabled) {
    return 'Advisor: off. Set one with /advisor <profile> or /advisor <profile>:<model>.';
  }
  const availability = status.registered
    ? `${status.sessionCalls}/${status.maxCallsPerSession} calls used this session`
    : 'available from the next session';
  return `Advisor: ${status.target} (${availability}).`;
}

/**
 * `/advisor` — show the advisor, set it (`<profile>` or `<profile>:<model>`), or turn it off. A
 * change the user makes is also saved as the default for later sessions.
 */
export async function executeAdvisorCommand(
  context: ICommandHostAdapterAccess & ICommandHostWorkspace,
  args: string,
): Promise<ICommandResult> {
  const adapters = context.getCommandHostAdapters?.() ?? {};
  const advisor = adapters.advisor;
  if (advisor === undefined) {
    return { success: false, message: 'The advisor is not available in this environment.' };
  }
  const value = args.trim();
  if (value.length === 0) {
    const status = advisor.status();
    return { success: true, message: describeStatus(status), data: { advisor: { ...status } } };
  }
  const result = advisor.set(value);
  if (!result.success || result.saved === undefined) {
    return { success: result.success, message: result.message };
  }
  const settings = adapters.settings;
  if (settings !== undefined && context.getCommandInvocationSource() === 'user') {
    const current = settings.read();
    if (result.saved === 'off') {
      const { [ADVISOR_SETTING_KEY]: _removed, ...rest } = current;
      settings.write(rest);
    } else {
      settings.write({ ...current, [ADVISOR_SETTING_KEY]: result.saved });
    }
  }
  return { success: true, message: result.message, data: { advisor: { ...advisor.status() } } };
}
