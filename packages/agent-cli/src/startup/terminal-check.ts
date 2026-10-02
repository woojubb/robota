import type { ITerminalOutput } from '@robota-sdk/agent-core';

/**
 * Emit a non-blocking warning when running on macOS Terminal.app,
 * which has known CJK/IME instability in raw/interactive mode.
 */
export function warnIfTerminalAppOnMacOS(terminal: ITerminalOutput, environment: Readonly<Record<string, string | undefined>>): void {
  if (process.platform !== 'darwin') return;
  if (environment['TERM_PROGRAM'] !== 'Apple_Terminal') return;
  terminal.writeError(
    '\n⚠  macOS Terminal.app detected: CJK/IME input may be unstable.\n' +
      '   Recommended: use iTerm2 (https://iterm2.com) for Korean/Japanese/Chinese input.\n' +
      '   Or use headless mode: -p "your prompt"\n',
  );
}
