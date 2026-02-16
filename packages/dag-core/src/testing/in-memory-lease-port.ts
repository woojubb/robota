import type { ILeasePort, ILeaseRecord } from '../interfaces/ports.js';

export class InMemoryLeasePort implements ILeasePort {
    private readonly records = new Map<string, ILeaseRecord>();

    public async acquire(leaseKey: string, ownerId: string, leaseDurationMs: number): Promise<ILeaseRecord | undefined> {
        const nowIso = new Date().toISOString();
        const nowEpochMs = Date.now();
        const existing = this.records.get(leaseKey);

        if (existing) {
            const existingLeaseUntilEpochMs = Date.parse(existing.leaseUntil);
            if (existingLeaseUntilEpochMs > nowEpochMs) {
                return undefined;
            }
        }

        const nextRecord: ILeaseRecord = {
            leaseKey,
            ownerId,
            acquiredAt: nowIso,
            leaseUntil: new Date(nowEpochMs + leaseDurationMs).toISOString()
        };

        this.records.set(leaseKey, nextRecord);
        return nextRecord;
    }

    public async renew(leaseKey: string, ownerId: string, leaseDurationMs: number): Promise<ILeaseRecord | undefined> {
        const current = this.records.get(leaseKey);
        if (!current || current.ownerId !== ownerId) {
            return undefined;
        }

        const nowEpochMs = Date.now();
        const renewed: ILeaseRecord = {
            leaseKey,
            ownerId,
            acquiredAt: current.acquiredAt,
            leaseUntil: new Date(nowEpochMs + leaseDurationMs).toISOString()
        };

        this.records.set(leaseKey, renewed);
        return renewed;
    }

    public async release(leaseKey: string, ownerId: string): Promise<void> {
        const current = this.records.get(leaseKey);
        if (!current || current.ownerId !== ownerId) {
            return;
        }

        this.records.delete(leaseKey);
    }

    public async get(leaseKey: string): Promise<ILeaseRecord | undefined> {
        return this.records.get(leaseKey);
    }
}
