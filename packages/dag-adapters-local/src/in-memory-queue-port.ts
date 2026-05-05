import type { IQueueMessage, IQueuePort } from '@robota-sdk/dag-core';

interface IInFlightMessage {
  message: IQueueMessage;
  ownerId: string;
  visibleAtEpochMs: number;
}

interface IQueueWaiter {
  resolve: () => void;
  timeout: ReturnType<typeof setTimeout>;
}

export class InMemoryQueuePort implements IQueuePort {
  private readonly pendingQueue: IQueueMessage[] = [];
  private readonly inFlight = new Map<string, IInFlightMessage>();
  private readonly waiters: IQueueWaiter[] = [];

  public async enqueue(message: IQueueMessage): Promise<void> {
    this.pendingQueue.push(message);
    this.notifyNextWaiter();
  }

  public async dequeue(
    workerId: string,
    visibilityTimeoutMs: number,
    waitTimeoutMs = 0,
  ): Promise<IQueueMessage | undefined> {
    const immediateMessage = this.tryDequeue(workerId, visibilityTimeoutMs);
    if (immediateMessage || waitTimeoutMs <= 0) {
      return immediateMessage;
    }

    await this.waitForMessage(waitTimeoutMs);
    return this.tryDequeue(workerId, visibilityTimeoutMs);
  }

  public async ack(messageId: string): Promise<void> {
    this.inFlight.delete(messageId);
  }

  public async nack(messageId: string): Promise<void> {
    const inFlight = this.inFlight.get(messageId);
    if (!inFlight) {
      return;
    }

    this.inFlight.delete(messageId);
    this.pendingQueue.unshift(inFlight.message);
    this.notifyNextWaiter();
  }

  private tryDequeue(workerId: string, visibilityTimeoutMs: number): IQueueMessage | undefined {
    this.requeueExpiredMessages();

    const nextMessage = this.pendingQueue.shift();
    if (!nextMessage) {
      return undefined;
    }

    const nowEpochMs = Date.now();
    this.inFlight.set(nextMessage.messageId, {
      message: nextMessage,
      ownerId: workerId,
      visibleAtEpochMs: nowEpochMs + visibilityTimeoutMs,
    });

    return nextMessage;
  }

  private requeueExpiredMessages(): void {
    const nowEpochMs = Date.now();

    for (const [messageId, inFlight] of this.inFlight.entries()) {
      if (inFlight.visibleAtEpochMs > nowEpochMs) {
        continue;
      }

      this.inFlight.delete(messageId);
      this.pendingQueue.push(inFlight.message);
    }
  }

  private async waitForMessage(waitTimeoutMs: number): Promise<void> {
    return new Promise((resolve) => {
      const waiter: IQueueWaiter = {
        resolve: () => {
          clearTimeout(waiter.timeout);
          this.removeWaiter(waiter);
          resolve();
        },
        timeout: setTimeout(() => {
          waiter.resolve();
        }, waitTimeoutMs),
      };

      this.waiters.push(waiter);
    });
  }

  private notifyNextWaiter(): void {
    const waiter = this.waiters.shift();
    waiter?.resolve();
  }

  private removeWaiter(waiter: IQueueWaiter): void {
    const index = this.waiters.indexOf(waiter);
    if (index >= 0) {
      this.waiters.splice(index, 1);
    }
  }
}
