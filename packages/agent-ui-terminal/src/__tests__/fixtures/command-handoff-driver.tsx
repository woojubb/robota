/**
 * Fixture: run the real `/shell` and `/editor` command executors
 * through the real `TerminalHandoffController` on a real PTY.
 *
 * A real Ink app (input hooks below a suspend gate, like the App) provides the live handoff; a minimal
 * host context wires the executors' three touch-points (`canHandoffTerminal` / `runWithTerminal` /
 * `getCwd`) to the controller. The session command-pipeline integration is already covered by the
 * framework functional tests with a fake handoff — this fixture exercises the one thing only a real
 * terminal can: the controller releasing raw mode so the child (subshell / `$EDITOR`) owns the TTY,
 * and `runWithTerminal` returning so the TUI resumes.
 *
 * argv: [mode ('shell'|'editor'), outputPath]. The `/shell` command text is fixed here rather than
 * taken from argv: argv only selects the mode, so no process input becomes shell text.
 *
 * Markers: `@@READY canHandoff=…@@`, `@@CMD_DONE@@`, `@@INPUT_READY n@@` (the input hook has mounted
 * for the n-th time: 2 once the TUI has taken the terminal back), `@@INPUT_AFTER_HANDOFF …@@`. Each is
 * also recorded as an event (`pty/fixture-event-log.ts`), which is what a test waits on. A JSON result
 * `{ success, exitCode?, message }` is written to outputPath.
 */
import { writeFileSync } from 'node:fs';

import { executeEditorCommand, executeShellCommand } from '@robota-sdk/agent-product/command/node';
import { createTestCommandHost } from '@robota-sdk/agent-framework/testing';
import { Box, Text, render, useInput } from 'ink';
import React from 'react';

import { useTerminalHandoffSuspension } from '../../hooks/useTerminalHandoffSuspension.js';
import { TerminalHandoffController } from '../../terminal-handoff-controller.js';
import { recordFixtureEvent } from '../pty/fixture-event-log.js';
import { readOneLineScript } from './read-one-line-script.js';

import type {
  ICommandHostTerminalHandoff,
  ICommandHostWorkspace,
} from '@robota-sdk/agent-framework';

const MODE = process.argv[2];
const OUTPUT_PATH = process.argv[3];
/**
 * Reads one line from the handed-off terminal and echoes it back, proving the child owned the TTY.
 * A `node -e` command runs the same in `sh` and in PowerShell, the shell `/shell` resolves on Windows.
 */
const SHELL_COMMAND = `node -e "${readOneLineScript('SHELL_GOT')}"`;

const controller = new TerminalHandoffController();
let resolveInputAfterHandoff: ((input: string) => void) | undefined;

/** Minimal host context — the shell/editor executors only read these three members. */
const context = {
  canHandoffTerminal: (): boolean => controller.canHandoffTerminal,
  runWithTerminal: <T,>(fn: () => Promise<T>): Promise<T> => controller.runWithTerminal(fn),
  getCwd: (): string => process.cwd(),
} satisfies ICommandHostTerminalHandoff & Pick<ICommandHostWorkspace, 'getCwd'>;

let inputMounts = 0;

function InputCapture(): React.ReactElement {
  useInput((input) => resolveInputAfterHandoff?.(input));
  // Declared after `useInput`, so its listener is attached when this runs. Keys sent earlier are lost.
  React.useEffect(() => {
    inputMounts += 1;
    marker(`INPUT_READY ${inputMounts}`);
  }, []);
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
  recordFixtureEvent(OUTPUT_PATH, line);
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

  // The fixture's `satisfies Pick<>` above is the honest part — it declares exactly the three
  // members these executors read. The widening cast existed only because the executors demand the
  // whole 46-member facade. The double supplies the rest so no cast is required.
  const ctx = createTestCommandHost({ overrides: context });
  const result =
    MODE === 'editor'
      ? await executeEditorCommand(ctx, '')
      : await executeShellCommand(ctx, SHELL_COMMAND);

  marker('CMD_DONE');
  const inputAfterHandoff = await new Promise<string>((resolve) => {
    resolveInputAfterHandoff = resolve;
  });
  marker(`INPUT_AFTER_HANDOFF ${inputAfterHandoff}`);
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
  marker(`ERROR ${String(error)}`);
  process.exit(1);
});

void main().catch((error) => {
  writeResult({ success: false, message: String(error) });
  marker(`ERROR ${String(error)}`);
  process.exit(1);
});
