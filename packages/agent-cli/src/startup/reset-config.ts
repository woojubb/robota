import { resetUserConfig } from '@robota-sdk/agent-framework';
import type { ITerminalOutput } from '@robota-sdk/agent-core';

export function runResetConfig(terminal: ITerminalOutput): void {
  const result = resetUserConfig();
  if (result.deleted) {
    terminal.writeLine(`Deleted ${result.path}`);
  } else {
    terminal.writeLine('No user settings found.');
  }
}
