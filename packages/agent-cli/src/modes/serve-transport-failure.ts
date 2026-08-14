import type { ITransportCompletionRecord } from '@robota-sdk/agent-interface-transport';

export interface IServeTransportFailureWaiter {
  waitForFailure(): Promise<ITransportCompletionRecord | undefined>;
}

export interface IServeFailureProcessPort {
  setExitCode(code: number): void;
  writeError(message: string): void;
}

/** Translate runner failure observation into the serve process's owned shutdown path. */
export async function settleOnServeTransportFailure(
  waiter: IServeTransportFailureWaiter,
  processPort: IServeFailureProcessPort,
  settle: (reason: string) => void,
): Promise<void> {
  try {
    const record = await waiter.waitForFailure();
    if (!record) return;
    processPort.setExitCode(record.outcome.exitCode);
    processPort.writeError(`transport failed: ${record.name} exited ${record.outcome.exitCode}\n`);
    settle('a transport failed');
  } catch (error) {
    processPort.setExitCode(1);
    const detail = error instanceof Error ? error.message : String(error);
    processPort.writeError(`transport failed: ${detail}\n`);
    settle('a transport failed');
  }
}
