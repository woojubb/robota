import type { TEventData } from '../interfaces/event-handler.js';

export type TWorkflowInstanceType = 'agent' | 'execution' | 'thinking' | 'response' | 'tool';

export interface IWorkflowInstanceRecord {
    type: TWorkflowInstanceType;
    id: string;
    lastEventType: string;
    lastEventTimestamp: Date;
    lastEvent: TEventData;
}

export class WorkflowInstanceRegistry {
    private records = new Map<string, IWorkflowInstanceRecord>();

    register(type: TWorkflowInstanceType, id: string, eventData: TEventData): void {
        const key = this.buildKey(type, id);
        if (this.records.has(key)) {
            throw new Error(`[INSTANCE-REGISTRY] Duplicate register for ${type}:${id}`);
        }
        this.records.set(key, {
            type,
            id,
            lastEventType: eventData.eventType,
            lastEventTimestamp: eventData.timestamp,
            lastEvent: eventData
        });
    }

    update(type: TWorkflowInstanceType, id: string, eventData: TEventData): void {
        const key = this.buildKey(type, id);
        if (!this.records.has(key)) {
            throw new Error(`[INSTANCE-REGISTRY] Missing instance for update: ${type}:${id}`);
        }
        this.records.set(key, {
            type,
            id,
            lastEventType: eventData.eventType,
            lastEventTimestamp: eventData.timestamp,
            lastEvent: eventData
        });
    }

    get(type: TWorkflowInstanceType, id: string): IWorkflowInstanceRecord | undefined {
        return this.records.get(this.buildKey(type, id));
    }

    clear(): void {
        this.records.clear();
    }

    private buildKey(type: TWorkflowInstanceType, id: string): string {
        if (!id || id.length === 0) {
            throw new Error(`[INSTANCE-REGISTRY] Missing instance id for type "${type}"`);
        }
        return `${type}:${id}`;
    }
}
