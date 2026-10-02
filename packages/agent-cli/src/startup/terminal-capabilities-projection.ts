import type { ITerminalCapabilityOverrides } from '@robota-sdk/agent-ui-terminal';

/** Only the The product shell interprets these product-specific environment variables. */
export function resolveProductTerminalCapabilities(
  env: Readonly<Record<string, string | undefined>>,
): ITerminalCapabilityOverrides {
  const overrides: { imeCursorPositioning?: boolean; turnMarks?: boolean } = {};
  if (env['PRODUCT_IME_CURSOR'] === '1') overrides.imeCursorPositioning = true;
  if (env['PRODUCT_IME_CURSOR'] === '0') overrides.imeCursorPositioning = false;
  if (env['PRODUCT_TURN_MARKS'] === '1') overrides.turnMarks = true;
  if (env['PRODUCT_TURN_MARKS'] === '0') overrides.turnMarks = false;
  return overrides;
}
