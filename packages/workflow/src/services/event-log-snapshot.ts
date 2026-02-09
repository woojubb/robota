import type { IEventLogSnapshot, IEventLogStore } from '../interfaces/event-log-store.js';

export interface IEventLogSnapshotPolicy {
    maxEvents: number;
    maxMilliseconds: number;
}

export class EventLogSnapshotService {
    private lastSnapshotAt = 0;
    private lastSnapshotSequenceId = 0;

    constructor(
        private readonly store: IEventLogStore,
        private readonly policy: IEventLogSnapshotPolicy
    ) {}

    maybeSnapshot(currentSequenceId: number, now: number = Date.now()): void {
        if (currentSequenceId <= this.lastSnapshotSequenceId) {
            throw new Error('[EVENT-LOG-SNAPSHOT] sequenceId must increase');
        }
        const reachedCount = currentSequenceId - this.lastSnapshotSequenceId >= this.policy.maxEvents;
        const reachedTime = now - this.lastSnapshotAt >= this.policy.maxMilliseconds;
        if (!reachedCount && !reachedTime) return;

        const snapshot: IEventLogSnapshot = {
            lastSequenceId: currentSequenceId,
            createdAt: new Date(now)
        };
        this.store.saveSnapshot(snapshot);
        this.lastSnapshotAt = now;
        this.lastSnapshotSequenceId = currentSequenceId;
    }
}
