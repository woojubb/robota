/**
 * TEST-007 / TERM-002 fixture: real-terminal handoff under a PTY.
 *
 * Renders a real Ink app that takes raw mode (useInput) BELOW a suspend gate — exactly like the real
 * App — and uses the real `TerminalHandoffController` + `useTerminalHandoffSuspension`. It performs an
 * actual handoff: `runWithTerminal` spawns a child that reads ONE line from the inherited terminal and
 * echoes it. If Ink released raw mode on suspend, the child receives the driver's keystrokes; after
 * the child exits, `runWithTerminal` must RETURN and the App must resume.
 *
 * Driven by `terminal-handoff-pty-e2e.test.ts`. Markers the harness keys off: `@@READY@@`,
 * `@@HANDOFF_STARTED@@`, `CHILD_GOT:[...]`, `@@RESUMED exit=N@@`. A JSON result is written to argv[0].
 */
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';

import { Box, Text, render, useInput } from 'ink';
import React from 'react';

import { useTerminalHandoffSuspension } from '../../hooks/useTerminalHandoffSuspension.js';
import { TerminalHandoffController } from '../../terminal-handoff-controller.js';

const OUTPUT_PATH = process.argv[2];
const controller = new TerminalHandoffController();

/** Input-bearing subtree: useInput lives BELOW the suspend gate, so it unmounts (Ink releases raw
 *  mode) while suspended — mirrors the real App. */
function InputCapture(): React.ReactElement {
  useInput(() => {});
  return <Text>READY</Text>;
}

function HandoffApp(): React.ReactElement {
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

function writeResult(result: Record<string, string | number | boolean>): void {
  if (OUTPUT_PATH) writeFileSync(OUTPUT_PATH, JSON.stringify(result), 'utf8');
}

async function main(): Promise<void> {
  const instance = render(<HandoffApp />);
  controller.setInkInstance(instance);

  // Wait for the App to mount + register its suspend hooks.
  await new Promise((resolve) => setTimeout(resolve, 300));
  const canHandoff = controller.canHandoffTerminal;
  marker(`READY canHandoff=${canHandoff}`);

  const exitCode = await controller.runWithTerminal(async () => {
    marker('HANDOFF_STARTED');
    return await new Promise<number>((resolve) => {
      const child = spawn('sh', ['-c', 'IFS= read -r line; printf "CHILD_GOT:[%s]\\n" "$line"'], {
        stdio: 'inherit',
      });
      child.on('exit', (code) => resolve(code ?? 0));
    });
  });

  // If runWithTerminal returned, the App resumed (finally → resume ran). Confirm with a marker.
  marker(`AFTER_HANDOFF exit=${exitCode}`);
  instance.unmount();
  await new Promise((resolve) => setTimeout(resolve, 150));
  marker(`RESUMED exit=${exitCode}`);

  writeResult({ canHandoff, exitCode, returned: true });
  await new Promise((resolve) => setTimeout(resolve, 100));
  process.exit(0);
}

process.on('uncaughtException', (error) => {
  writeResult({ error: String(error), returned: false });
  process.stdout.write(`\r\n@@ERROR ${String(error)}@@\r\n`);
  process.exit(1);
});

void main().catch((error) => {
  writeResult({ error: String(error), returned: false });
  process.stdout.write(`\r\n@@ERROR ${String(error)}@@\r\n`);
  process.exit(1);
});
