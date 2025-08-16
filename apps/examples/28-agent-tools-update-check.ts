import { Robota } from '@robota-sdk/agents';
import { createZodFunctionTool } from '@robota-sdk/agents';
import { WorkflowEventSubscriber } from '@robota-sdk/workflow';
import { z } from 'zod';
import { ActionTrackingEventService } from '@robota-sdk/agents';

// Minimal Bridge to route events into WorkflowEventSubscriber immediately
class BridgeEventService {
    private subscriber: any;
    private queue: Array<{ type: string; data: unknown }> = [];
    private processing = false;
    constructor(subscriber: any) {
        this.subscriber = subscriber;
    }
    emit(eventType: unknown, data: unknown): void {
        this.queue.push({ type: String(eventType), data });
        void this.drain();
    }
    private async drain(): Promise<void> {
        if (this.processing) return;
        this.processing = true;
        try {
            while (this.queue.length > 0) {
                const { type, data } = this.queue.shift()!;
                await this.subscriber.processEvent(type, data);
            }
        } finally {
            this.processing = false;
        }
    }
}

async function main() {
    const subscriber = new WorkflowEventSubscriber({ logger: { debug() { }, info() { }, warn() { }, error() { } } } as any);
    const bridge = new BridgeEventService(subscriber);
    const eventService = new ActionTrackingEventService(bridge as any);

    // Create agent (no run), wired to our event service so agent.created will be captured
    const agent = new Robota({
        name: 'ToolUpdateTestAgent',
        aiProviders: [{ name: 'noop', version: '0.0.0', async chat() { return { role: 'assistant', content: null } as any; }, async generateResponse() { return { content: null } as any; } } as any],
        defaultModel: { provider: 'noop', model: 'noop-model' },
        tools: [],
        eventService
    });

    // Helper to dump nodes
    const dumpNodes = (label: string) => {
        const wf = (subscriber as any).exportWorkflow();
        const nodes = wf?.nodes || [];
        // Filtered log prefix for user
        console.log(`[TOOL-UPDATE-VERIFY] ${label} nodes=${nodes.length}`);
        const agentNodes = nodes.filter((n: any) => n.type === 'agent');
        console.log(`[TOOL-UPDATE-VERIFY] ${label} agent.nodes=${agentNodes.length}`);
        if (agentNodes[0]) {
            const tools = agentNodes[0]?.data?.tools;
            console.log(`[TOOL-UPDATE-VERIFY] ${label} agent.tools=${JSON.stringify(tools)}`);
            const version = agentNodes[0]?.data?.configVersion;
            console.log(`[TOOL-UPDATE-VERIFY] ${label} agent.configVersion=${version}`);
        }
    };

    // BEFORE
    dumpNodes('BEFORE_UPDATE');

    // Build a dummy zod tool and update tools
    const dummySchema = z.object({ value: z.string().optional() });
    const dummyTool = createZodFunctionTool(
        'playground_dummy_tool',
        'Returns echo value',
        dummySchema,
        async (params) => (params?.value ?? 'ok:playground')
    );

    await agent.updateTools([dummyTool] as any);

    // Allow async event processing to complete
    await new Promise((r) => setTimeout(r, 100));

    // AFTER
    dumpNodes('AFTER_UPDATE');
}

main().catch((err) => {
    console.error('[TOOL-UPDATE-VERIFY] ERROR', err);
    process.exit(1);
});
