import { promises as fs } from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { Robota, ActionTrackingEventService, DefaultConsoleLogger } from '@robota-sdk/agents';
import { OpenAIProvider } from '@robota-sdk/openai';
import { WorkflowEventSubscriber } from '@robota-sdk/workflow';
import { z } from 'zod';
import { createZodFunctionTool } from '@robota-sdk/agents';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Test tool
const calculateTool = createZodFunctionTool(
    'calculate',
    'Perform basic math calculations',
    z.object({
        a: z.number().describe('First number'),
        b: z.number().describe('Second number'),
        operation: z.enum(['add', 'subtract', 'multiply', 'divide'])
    }),
    async (params) => {
        const { a, b, operation } = params;
        let result: number;
        switch (operation) {
            case 'add': result = a + b; break;
            case 'subtract': result = a - b; break;
            case 'multiply': result = a * b; break;
            case 'divide': result = b !== 0 ? a / b : 0; break;
        }
        return { data: `Result: ${result}` };
    }
);

async function testUpdateToolsSnapshot() {
    console.log('\n🧪 Testing updateTools with snapshot verification...\n');

    const provider = new OpenAIProvider({
        apiKey: process.env.OPENAI_API_KEY || 'test-key',
        model: 'gpt-4o-mini'
    });

    // Create workflow workflowSubscriber
    const workflowSubscriber = new WorkflowEventSubscriber();

    // Create BridgeEventService (from example 26)
    class BridgeEventService {
        private workflowSubscriber: WorkflowEventSubscriber;

        constructor(workflowSubscriber: WorkflowEventSubscriber) {
            this.workflowSubscriber = workflowSubscriber;
        }

        emit(eventType: unknown, data: unknown): void {
            // Process event synchronously for test
            this.workflowSubscriber.processEvent(String(eventType), data);
        }
    }

    const bridgeEventService = new BridgeEventService(workflowSubscriber);
    const globalEventService = new ActionTrackingEventService(bridgeEventService as any);

    // Create agent with event service
    const agent = new Robota({
        name: 'SnapshotTestAgent',
        systemPrompt: 'You are a test agent',
        temperature: 0,
        aiProviders: [provider],
        defaultModel: { provider: 'openai', model: 'gpt-4o-mini' },
        tools: [],
        eventService: globalEventService
    });

    // Wait for agent creation event to process
    await new Promise(resolve => setTimeout(resolve, 200));

    // Get snapshot BEFORE updateTools
    console.log('�� Getting snapshot BEFORE updateTools...');
    const snapshotBefore = workflowSubscriber.exportWorkflow();
    const agentNodeBefore = snapshotBefore.nodes.find((n: any) => n.type === 'agent');

    console.log('\n🔍 BEFORE updateTools:');
    console.log('- Agent node ID:', agentNodeBefore?.id);
    console.log('- Agent sourceId:', agentNodeBefore?.data?.sourceId);
    console.log('- Tools in node data:', agentNodeBefore?.data?.tools || 'undefined');
    console.log('- ConfigVersion in node data:', agentNodeBefore?.data?.configVersion || 'undefined');

    // Update tools
    console.log('\n📝 Calling updateTools with calculateTool...');
    const updateResult = await agent.updateTools([calculateTool]);
    console.log('- Update result:', updateResult);

    // Wait for event processing
    await new Promise(resolve => setTimeout(resolve, 200));

    // Get snapshot AFTER updateTools
    console.log('\n📸 Getting snapshot AFTER updateTools...');
    const snapshotAfter = workflowSubscriber.exportWorkflow();
    const agentNodeAfter = snapshotAfter.nodes.find((n: any) => n.type === 'agent');

    console.log('\n🔍 AFTER updateTools:');
    console.log('- Agent node ID:', agentNodeAfter?.id);
    console.log('- Agent sourceId:', agentNodeAfter?.data?.sourceId);
    console.log('- Tools in node data:', agentNodeAfter?.data?.tools || 'undefined');
    console.log('- ConfigVersion in node data:', agentNodeAfter?.data?.configVersion || 'undefined');

    // Compare
    console.log('\n📊 Comparison:');
    console.log('- Node ID same?', agentNodeBefore?.id === agentNodeAfter?.id);
    console.log('- Tools changed?',
        JSON.stringify(agentNodeBefore?.data?.tools) !== JSON.stringify(agentNodeAfter?.data?.tools)
    );
    console.log('- ConfigVersion changed?',
        agentNodeBefore?.data?.configVersion !== agentNodeAfter?.data?.configVersion
    );

    // Save snapshots for inspection
    const outputDir = path.join(__dirname, 'data');
    await fs.mkdir(outputDir, { recursive: true });

    await fs.writeFile(
        path.join(outputDir, 'snapshot-before-updatetools.json'),
        JSON.stringify(snapshotBefore, null, 2)
    );
    await fs.writeFile(
        path.join(outputDir, 'snapshot-after-updatetools.json'),
        JSON.stringify(snapshotAfter, null, 2)
    );

    console.log('\n�� Snapshots saved to data/ directory');

    // Verify the change
    if (agentNodeAfter?.data?.tools?.includes('calculate')) {
        console.log('\n✅ SUCCESS: Tool was added to agent node data!');
    } else {
        console.log('\n❌ FAILED: Tool was NOT added to agent node data!');
    }
}

testUpdateToolsSnapshot().catch(console.error);
