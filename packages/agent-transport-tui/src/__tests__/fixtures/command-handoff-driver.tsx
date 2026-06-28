/**
 * TEST-007 / TERM-003 + TERM-004 fixture: run the real `/shell` and `/editor` command executors
 * through the real `TerminalHandoffController` on a real PTY.
 *
 * A real Ink app (input hooks below a suspend gate, like the App) provides the live handoff; a minimal
 * host context wires the executors' three touch-points (`canHandoffTerminal` / `runWithTerminal` /
 * `getCwd`) to the controller. The session command-pipeline integration is already covered by the
 * framework functional tests with a fake handoff — this fixture exercises the one thing only a real
 * terminal can: the controller releasing raw mode so the child (subshell / `$EDITOR`) owns the TTY,
 * and `runWithTerminal` returning so the TUI resumes.
 *
 * argv: [mode ('shell'|'editor'), outputPath, commandArg?]. Markers: `@@READY canHandoff=…@@`,
 * `@@CMD_DONE@@`. A JSON result `{ success, exitCode?, message }` is written to outputPath.
 */
import { writeFileSync } from 'node:fs';

import { executeEditorCommand, executeShellCommand } from '@robota-sdk/agent-command';
import { Box, Text, render, useInput } from 'ink';
import React from 'react';

import { useTerminalHandoffSuspension } from '../../hooks/useTerminalHandoffSuspension.js';
import { TerminalHandoffController } from '../../terminal-handoff-controller.js';

import type { ICommandHostContext } from '@robota-sdk/agent-framework';

const MODE = process.argv[2];
const OUTPUT_PATH = process.argv[3];
const COMMAND_ARG = process.argv[4] ?? '';

const controller = new TerminalHandoffController();

/** Minimal host context — the shell/editor executors only read these three members. */
const context = {
  canHandoffTerminal: (): boolean => controller.canHandoffTerminal,
  runWithTerminal: <T,>(fn: () => Promise<T>): Promise<T> => controller.runWithTerminal(fn),
  getCwd: (): string => process.cwd(),
} satisfies Pick<ICommandHostContext, 'canHandoffTerminal' | 'runWithTerminal' | 'getCwd'>;

function InputCapture(): React.ReactElement {
  useInput(() => {});
  return <Text>READY</Text>;
}

function CommandApp(): React.ReactElement {
  const suspended = useTerminalHandoffSuspension(controller);
  if (suspended) return <Box />;
  return (
    <Box>
      <InputCapture />
    </Box>
  );
}

function marker(line: string): void {
  process.stdout.write(`\r\n@@${line}@@\r\n`);
}

function writeResult(result: Record<string, string | number | boolean | undefined>): void {
  if (OUTPUT_PATH) writeFileSync(OUTPUT_PATH, JSON.stringify(result), 'utf8');
}

async function main(): Promise<void> {
  const instance = render(<CommandApp />);
  controller.setInkInstance(instance);
  await new Promise((resolve) => setTimeout(resolve, 300));
  marker(`READY canHandoff=${controller.canHandoffTerminal}`);

  const ctx = context as ICommandHostContext;
  const result =
    MODE === 'editor'
      ? await executeEditorCommand(ctx, COMMAND_ARG)
      : await executeShellCommand(ctx, COMMAND_ARG);

  marker('CMD_DONE');
  instance.unmount();
  await new Promise((resolve) => setTimeout(resolve, 150));

  writeResult({
    success: result.success,
    message: result.message,
    exitCode: (result.data as { exitCode?: number } | undefined)?.exitCode,
  });
  await new Promise((resolve) => setTimeout(resolve, 100));
  process.exit(0);
}

process.on('uncaughtException', (error) => {
  writeResult({ success: false, message: String(error) });
  process.stdout.write(`\r\n@@ERROR ${String(error)}@@\r\n`);
  process.exit(1);
});

void main().catch((error) => {
  writeResult({ success: false, message: String(error) });
  process.stdout.write(`\r\n@@ERROR ${String(error)}@@\r\n`);
  process.exit(1);
});
