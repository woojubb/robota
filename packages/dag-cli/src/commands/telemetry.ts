import type { IDagCliIo } from '../types.js';
import { SUCCESS_EXIT_CODE, USAGE_ERROR_EXIT_CODE } from '../types.js';
import {
  readTelemetryConfig,
  enableTelemetry,
  disableTelemetry,
  isTelemetryEnabled,
} from '../telemetry.js';

export interface ITelemetryCommandOptions {
  readonly io: IDagCliIo;
}

// ---------------------------------------------------------------------------
// Help
// ---------------------------------------------------------------------------

const TELEMETRY_HELP_TEXT = `Usage: dag telemetry <subcommand>

Manage anonymous usage analytics (opt-in).

Subcommands:
  status   Show current telemetry setting
  on       Enable anonymous telemetry
  off      Disable anonymous telemetry

Telemetry is always disabled in CI environments (CI=true)
or when ROBOTA_DAG_TELEMETRY=0.

Data collected (only when enabled):
  command, success/failure, duration, node types, node count,
  OS, Node.js version, CLI version, daily-rotated session ID.

No code, prompts, or output content is ever collected.
`;

// ---------------------------------------------------------------------------
// Subcommand handlers
// ---------------------------------------------------------------------------

async function telemetryStatus(options: ITelemetryCommandOptions): Promise<number> {
  const { io } = options;

  const isCi = process.env['CI'] === 'true';
  const isEnvDisabled = process.env['ROBOTA_DAG_TELEMETRY'] === '0';

  if (isCi) {
    io.write(`Telemetry: disabled (CI environment)\n`);
    return SUCCESS_EXIT_CODE;
  }

  if (isEnvDisabled) {
    io.write(`Telemetry: disabled (ROBOTA_DAG_TELEMETRY=0)\n`);
    return SUCCESS_EXIT_CODE;
  }

  const config = await readTelemetryConfig();
  const enabled = config.telemetryEnabled === true;

  if (enabled) {
    io.write(`Telemetry: enabled\n`);
    io.write(`Disable with: dag telemetry off\n`);
  } else {
    io.write(`Telemetry: disabled (default)\n`);
    io.write(`Run 'dag telemetry on' to enable anonymous usage analytics.\n`);
  }

  return SUCCESS_EXIT_CODE;
}

async function telemetryOn(options: ITelemetryCommandOptions): Promise<number> {
  const { io } = options;

  const isCi = process.env['CI'] === 'true';
  const isEnvDisabled = process.env['ROBOTA_DAG_TELEMETRY'] === '0';

  if (isCi) {
    io.write(`Telemetry cannot be enabled in CI environments.\n`);
    return USAGE_ERROR_EXIT_CODE;
  }

  if (isEnvDisabled) {
    io.write(`Telemetry cannot be enabled while ROBOTA_DAG_TELEMETRY=0 is set.\n`);
    return USAGE_ERROR_EXIT_CODE;
  }

  await enableTelemetry();
  io.write(`✓ Anonymous usage analytics enabled — thank you for contributing!\n\n`);
  io.write(`What is collected (anonymous, never personally identifiable):\n`);
  io.write(`  • Which commands you run (never your code, prompts, or outputs)\n`);
  io.write(`  • Success/failure, execution time\n`);
  io.write(`  • Node types and counts (never node content)\n\n`);
  io.write(`This data drives decisions about which features to improve.\n`);
  io.write(`Disable anytime: dag telemetry off\n\n`);
  io.write(`Add this badge to your README to show your support:\n`);
  io.write(
    `  [![robota-dag telemetry](https://img.shields.io/badge/robota--dag-telemetry%20on-brightgreen)](https://github.com/woojubb/robota)\n`,
  );
  return SUCCESS_EXIT_CODE;
}

async function telemetryOff(options: ITelemetryCommandOptions): Promise<number> {
  const { io } = options;
  await disableTelemetry();
  io.write(`✓ Telemetry disabled.\n`);
  return SUCCESS_EXIT_CODE;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * Execute the `dag telemetry` subcommand.
 *
 * @param args - The argv slice starting after the `telemetry` keyword.
 * @param options - IO abstraction.
 * @returns Exit code.
 */
export async function telemetryCommand(
  args: readonly string[],
  options: ITelemetryCommandOptions,
): Promise<number> {
  const { io } = options;

  const subcommand = args[0];

  if (subcommand === '--help' || subcommand === '-h' || subcommand === undefined) {
    io.write(TELEMETRY_HELP_TEXT);
    return SUCCESS_EXIT_CODE;
  }

  switch (subcommand) {
    case 'status':
      return telemetryStatus(options);
    case 'on':
      return telemetryOn(options);
    case 'off':
      return telemetryOff(options);
    default:
      io.write(
        `Error: Unknown telemetry subcommand '${subcommand}'. Run 'dag telemetry --help'.\n`,
      );
      return USAGE_ERROR_EXIT_CODE;
  }
}
