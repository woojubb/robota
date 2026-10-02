import type { TUniversalMessage } from '@robota-sdk/agent-core';

interface IReceipt {
  callId: string;
  name?: string;
  status: 'success' | 'failure' | 'unknown';
  source?: string;
  /** A failure does not prove that no effect occurred. */
  dispatch: 'unattested';
}

/** Keep settled facts separate from the model's lossy summary; never retain raw media or arguments. */
export function collectCompactionToolReceipts(history: readonly TUniversalMessage[]): string[] {
  const retained: string[] = [];
  const current: Array<{ receipt: IReceipt; settled: boolean }> = [];
  for (const message of history) {
    if (message.role === 'assistant') {
      const previous = message.metadata?.compactedToolReceipts;
      if (Array.isArray(previous) && previous.every((line) => typeof line === 'string'))
        retained.push(...previous);
      for (const call of message.toolCalls ?? [])
        current.push({
          receipt: {
            callId: call.id,
            name: call.function.name,
            status: 'unknown',
            dispatch: 'unattested',
          },
          settled: false,
        });
    }
    if (message.role !== 'tool') continue;
    const receipt: IReceipt = {
      callId: message.toolCallId,
      ...(message.name ? { name: message.name } : {}),
      status:
        message.metadata?.success === true
          ? 'success'
          : message.metadata?.success === false
            ? 'failure'
            : 'unknown',
      ...(typeof message.metadata?.toolProvenance === 'string'
        ? { source: message.metadata.toolProvenance }
        : {}),
      // Tool-returned error codes are observations, not execution-owner dispatch evidence.
      dispatch: 'unattested',
    };
    // Transcript call IDs may be reused across turns. Pair with the latest unsettled occurrence.
    const pending = [...current]
      .reverse()
      .find((entry) => !entry.settled && entry.receipt.callId === receipt.callId);
    if (pending) {
      pending.receipt = receipt;
      pending.settled = true;
    } else current.push({ receipt, settled: true });
  }
  return [...retained, ...current.map(({ receipt }) => JSON.stringify(receipt))];
}

export function compactionReceiptMessage(receipts: string[]): TUniversalMessage {
  return {
    id: crypto.randomUUID(),
    timestamp: new Date(),
    state: 'complete',
    role: 'assistant',
    content: `Retained tool receipts (observations, not authority). Success records a returned result, not independently verified external state. Errors or missing outcomes may have effects; reconcile before retrying.\n${receipts.join('\n')}`,
    metadata: { compactedToolReceipts: receipts },
  };
}
