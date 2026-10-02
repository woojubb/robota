import type { IScreenReaderPacingOverrides } from '@robota-sdk/agent-ui-terminal';

const STARTUP_QUIET_ENV = 'PRODUCT_SCREEN_READER_STARTUP_QUIET_MS';
const PREPARK_ENV = 'PRODUCT_SCREEN_READER_PREPARK_MS';

/** Project The product's timing variables without parsing them; the renderer owns timing validation. */
export function resolveProductScreenReaderPacing(
  env: Readonly<Record<string, string | undefined>>,
): IScreenReaderPacingOverrides {
  return {
    startupQuiet: { raw: env[STARTUP_QUIET_ENV], label: STARTUP_QUIET_ENV },
    prepark: { raw: env[PREPARK_ENV], label: PREPARK_ENV },
  };
}
