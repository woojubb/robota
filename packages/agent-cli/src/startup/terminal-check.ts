import type { ITerminalOutput } from '@robota-sdk/agent-core';

/**
 * Emit a non-blocking warning when running on macOS Terminal.app,
 * which has known CJK/IME instability in raw/interactive mode.
 */
export function warnIfTerminalAppOnMacOS(terminal: ITerminalOutput): void {
  if (process.platform !== 'darwin') return;
  if (process.env['TERM_PROGRAM'] !== 'Apple_Terminal') return;
  terminal.writeError(
    '\n⚠  macOS Terminal.app detected: CJK/IME input may be unstable.\n' +
      '   Recommended: use iTerm2 (https://iterm2.com) for Korean/Japanese/Chinese input.\n' +
      '   Or use headless mode: robota -p "your prompt"\n',
  );
}
