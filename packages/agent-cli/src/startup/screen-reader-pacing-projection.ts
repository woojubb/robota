import type { IScreenReaderPacingOverrides } from '@robota-sdk/agent-ui-terminal';

const STARTUP_QUIET_ENV = 'ROBOTA_SCREEN_READER_STARTUP_QUIET_MS';
const PREPARK_ENV = 'ROBOTA_SCREEN_READER_PREPARK_MS';

/** Project Robota's timing variables without parsing them; the renderer owns timing validation. */
export function resolveRobotaScreenReaderPacing(
  env: Readonly<Record<string, string | undefined>>,
): IScreenReaderPacingOverrides {
  return {
    startupQuiet: { raw: env[STARTUP_QUIET_ENV], label: STARTUP_QUIET_ENV },
    prepark: { raw: env[PREPARK_ENV], label: PREPARK_ENV },
  };
}
