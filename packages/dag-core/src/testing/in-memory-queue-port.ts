import type { IQueueMessage, IQueuePort } from '../interfaces/ports.js';

interface IInFlightMessage {
    message: IQueueMessage;
    ownerId: string;
    visibleAtEpochMs: number;
}

export class InMemoryQueuePort implements IQueuePort {
    private readonly pendingQueue: IQueueMessage[] = [];
    private readonly inFlight = new Map<string, IInFlightMessage>();

    public async enqueue(message: IQueueMessage): Promise<void> {
        this.pendingQueue.push(message);
    }

    public async dequeue(workerId: string, visibilityTimeoutMs: number): Promise<IQueueMessage | undefined> {
        this.requeueExpiredMessages();

        const nextMessage = this.pendingQueue.shift();
        if (!nextMessage) {
            return undefined;
        }

        const nowEpochMs = Date.now();
        this.inFlight.set(nextMessage.messageId, {
            message: nextMessage,
            ownerId: workerId,
            visibleAtEpochMs: nowEpochMs + visibilityTimeoutMs
        });

        return nextMessage;
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
}
