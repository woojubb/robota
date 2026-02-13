import { describe, expect, it, vi } from 'vitest';
import type { IBaseEventData, IEventContext } from '@robota-sdk/agents';
import type { IWorkflowEventSubscriber } from '../services/workflow-event-subscriber.js';
import { WorkflowEventServiceBridge } from '../services/workflow-event-service-bridge.js';

const validContext: IEventContext = {
    ownerType: 'execution',
    ownerId: 'exec_1',
    ownerPath: [{ type: 'execution', id: 'exec_1' }]
};

const validData: IBaseEventData = {
    timestamp: new Date(0)
};

function createSubscriber(processEventImpl?: IWorkflowEventSubscriber['processEvent']): IWorkflowEventSubscriber {
    return {
        processEvent: processEventImpl ?? (async () => undefined),
        subscribeToWorkflowSnapshots: () => () => undefined,
        exportWorkflow: () => ({
            __workflowType: 'UniversalWorkflowStructure',
            id: 'test',
            name: 'test',
            nodes: [],
            edges: [],
            metadata: {
                createdAt: new Date(0).toISOString(),
                updatedAt: new Date(0).toISOString(),
                metrics: { totalNodes: 0, totalEdges: 0 }
            },
            layout: {
                algorithm: 'none',
                direction: 'TB',
                spacing: { nodeSpacing: 0, levelSpacing: 0 },
                alignment: { horizontal: 'center', vertical: 'top' }
            }
        })
    };
}

describe('WorkflowEventServiceBridge', () => {
    it('should reject missing timestamp and ownerPath', () => {
        const bridge = new WorkflowEventServiceBridge(createSubscriber());
        expect(() => bridge.emit('execution.start', { timestamp: 'bad' as unknown as Date }, validContext)).toThrow(
            'Missing or invalid timestamp'
        );
        expect(() => bridge.emit('execution.start', validData)).toThrow('Missing context.ownerPath');
    });

    it('should reject invalid ownerPath segments', () => {
        const bridge = new WorkflowEventServiceBridge(createSubscriber());
        expect(() =>
            bridge.emit('execution.start', validData, {
                ...validContext,
                ownerPath: [{ type: '', id: 'x' }]
            })
        ).toThrow('missing segment type');
        expect(() =>
            bridge.emit('execution.start', validData, {
                ...validContext,
                ownerPath: [{ type: 'execution', id: '' }]
            })
        ).toThrow('missing segment id');
    });

    it('should process events and notify listeners', async () => {
        const processEvent = vi.fn().mockResolvedValue(undefined);
        const bridge = new WorkflowEventServiceBridge(createSubscriber(processEvent));
        const listener = vi.fn();
        bridge.subscribe(listener);

        bridge.emit('execution.start', {
            ...validData,
            context: { ownerType: 'ignored', ownerId: 'ignored', ownerPath: [] }
        }, validContext);
        await bridge.flush();

        expect(processEvent).toHaveBeenCalledTimes(1);
        expect(listener).toHaveBeenCalledTimes(1);
        bridge.unsubscribe(listener);
    });

    it('should surface async processing failure through flush', async () => {
        const bridge = new WorkflowEventServiceBridge(createSubscriber(async () => {
            throw new Error('bridge-failure');
        }));

        bridge.emit('execution.error', validData, validContext);
        await expect(bridge.flush()).rejects.toThrow('bridge-failure');
    });
});
