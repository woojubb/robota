import type { ITerminalCapabilityOverrides } from '@robota-sdk/agent-ui-terminal';

/** Only the Robota shell interprets these product-specific environment variables. */
export function resolveRobotaTerminalCapabilities(
  env: Readonly<Record<string, string | undefined>>,
): ITerminalCapabilityOverrides {
  const overrides: { imeCursorPositioning?: boolean; turnMarks?: boolean } = {};
  if (env['ROBOTA_IME_CURSOR'] === '1') overrides.imeCursorPositioning = true;
  if (env['ROBOTA_IME_CURSOR'] === '0') overrides.imeCursorPositioning = false;
  if (env['ROBOTA_TURN_MARKS'] === '1') overrides.turnMarks = true;
  if (env['ROBOTA_TURN_MARKS'] === '0') overrides.turnMarks = false;
  return overrides;
}
