/**
 * SCREEN-1992 — focus-reporting override resolver (agent-cli owned).
 *
 * The TUI asks the terminal to report focus changes (DECSET 1004) so it knows when the user is away
 * and can recap what happened on return. The mode is harmless where unimplemented, so there is no
 * per-terminal table; what the product shell owns is the kill switch, read here from its own
 * environment and injected as an option — the TUI package reads no product-named literal for it.
 *
 * `ROBOTA_FOCUS_EVENTS=0` turns the mode off (the TUI falls back to input idleness), `=1` forces it
 * on (e.g. a multiplexer that synthesizes focus events but is not a TTY pair), anything else leaves
 * the TUI's own TTY gate in charge.
 */
const FOCUS_EVENTS_ENV = 'ROBOTA_FOCUS_EVENTS';

export function resolveFocusReportingOverride(
  env: Readonly<Record<string, string | undefined>>,
): boolean | undefined {
  const value = env[FOCUS_EVENTS_ENV]?.trim();
  if (value === '1') return true;
  if (value === '0') return false;
  return undefined;
}
