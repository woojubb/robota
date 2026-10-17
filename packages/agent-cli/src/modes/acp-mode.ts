import { buildRuntimeSession } from '@robota-sdk/agent-framework';
import { createAcpTransport } from '@robota-sdk/agent-transport-acp';

import { runAcpSlashCommand } from './acp-command-port.js';
import { shutdownSession } from './session-shutdown.js';

import type { ICliRuntimeContext } from '../product/runtime-context.js';
import type { TInteractiveSessionOptions } from '@robota-sdk/agent-framework';
import type { TAcpWorkspaceAdmission } from '@robota-sdk/agent-transport-acp';
import type { Readable, Writable } from 'node:stream';

export interface IAcpModeOptions {
  readonly productRuntime: ICliRuntimeContext;
  readonly sessionOptions: TInteractiveSessionOptions;
  readonly version: string;
  /** The directory the session is rooted at; the editor's `session/new` must name it. */
  readonly cwd: string;
  /** The process input, and the protocol-only output reserved before startup could print to stdout. */
  readonly input: Readable;
  readonly output: Writable;
  readonly admitWorkspace: () => TAcpWorkspaceAdmission;
}

/** One product session, one ACP carrier; process signals and exit policy belong to this shell. */
export async function runAcpMode(options: IAcpModeOptions): Promise<void> {
  const session = buildRuntimeSession(options.sessionOptions);
  const transport = createAcpTransport({
    input: options.input,
    output: options.output,
    agentInfo: {
      name: options.productRuntime.config.identity.cliName,
      version: options.version,
    },
    cwd: options.cwd,
    admitWorkspace: options.admitWorkspace,
    executeCommand: (text, signal) => runAcpSlashCommand(session, text, signal),
    // stdout carries the protocol; what the editor does not receive goes where logs go.
    onDeliveryError: (error, context) => {
      process.stderr.write(`ACP ${context}: ${error.message}\n`);
    },
  });
  transport.attach(session);
  let onStop: (() => void) | undefined;
  const stopped = new Promise<void>((resolve) => {
    onStop = resolve;
  });
  const signal = (): void => onStop?.();
  process.once('SIGINT', signal);
  process.once('SIGTERM', signal);
  try {
    // A signal or the editor closing its input must reach teardown even while the carrier starts.
    await Promise.race([transport.start(), transport.waitForClose(), stopped]);
    await Promise.race([transport.waitForClose(), stopped]);
  } finally {
    process.off('SIGINT', signal);
    process.off('SIGTERM', signal);
    try {
      await transport.stop();
    } finally {
      await shutdownSession(session, 'ACP stdio carrier closed', 'ACP');
    }
  }
}
