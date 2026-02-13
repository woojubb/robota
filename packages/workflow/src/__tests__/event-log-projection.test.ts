import { describe, expect, it } from 'vitest';
import { AGENT_EVENTS, AGENT_EVENT_PREFIX, composeEventName, type IOwnerPathSegment } from '@robota-sdk/agents';
import type { TEventData } from '../interfaces/event-handler.js';
import type { TEventLogRecord } from '../interfaces/event-log.js';
import { WorkflowProjection } from '../services/workflow-projection.js';

const createdEventName = composeEventName(AGENT_EVENT_PREFIX, AGENT_EVENTS.CREATED);

const buildRecord = (agentId: string): TEventLogRecord => {
    const ownerPath: IOwnerPathSegment[] = [{ type: 'agent', id: agentId }];
    const eventData: TEventData = {
        eventType: createdEventName,
        timestamp: new Date(0),
        context: { ownerPath }
    };
    return {
        eventName: createdEventName,
        sequenceId: 1,
        timestamp: eventData.timestamp,
        eventData,
        context: eventData.context
    };
};

const toSignature = (updates: Array<{ action: string; node?: { id: string; type: string; data?: { sourceId?: string } } }>) =>
    updates.map(update =>
        update.action === 'create' && update.node
            ? {
                action: update.action,
                id: update.node.id,
                type: update.node.type,
                sourceId: update.node.data?.sourceId
            }
            : { action: update.action }
    );

describe('WorkflowProjection', () => {
    it('should produce consistent updates for same event', async () => {
        const record = buildRecord('agent_1');
        const projectionA = new WorkflowProjection();
        const projectionB = new WorkflowProjection();

        const updatesA = await projectionA.apply(record);
        const updatesB = await projectionB.apply(record);

        expect(updatesA).toHaveLength(1);
        expect(updatesB).toHaveLength(1);
        expect(toSignature(updatesA)).toEqual(toSignature(updatesB));
    });

    it('should throw when ownerPath is missing', async () => {
        const record = buildRecord('agent_1');
        const projection = new WorkflowProjection();
        const badRecord: TEventLogRecord = {
            ...record,
            context: { ...record.context, ownerPath: [] }
        };

        await expect(projection.apply(badRecord)).rejects.toThrow('ownerPath');
    });
});
