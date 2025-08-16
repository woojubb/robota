import { promises as fs } from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { Robota, EventService } from '@robota-sdk/agents';
import { OpenAIProvider } from '@robota-sdk/openai';
import { WorkflowEventSubscriber } from '@robota-sdk/workflow';
import { z } from 'zod';
import { FunctionTool, createZodFunctionTool } from '@robota-sdk/agents';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Mock tool
const echoTool = createZodFunctionTool(
    'echo_test',
    'Echo back test values',
    z.object({ value: z.string() }),
    async (params) => ({ data: `Echo: ${params.value}` })
);

async function testConfigUpdateSnapshot() {
    console.log('\n🧪 Testing CONFIG_UPDATED event and snapshot emission...\n');

    const provider = new OpenAIProvider({
        apiKey: process.env.OPENAI_API_KEY || 'test-key',
        model: 'gpt-4o-mini'
    });

    // Create global event service to bridge events
    const globalEventService = new EventService({ logger: console });

    // Create workflow subscriber to monitor events
    const subscriber = new WorkflowEventSubscriber();
    const snapshotCount = { value: 0 };
    const lastSnapshot = { value: null as any };

    // Subscribe to workflow snapshots
    subscriber.subscribeToWorkflowSnapshots((snapshot) => {
        snapshotCount.value++;
        lastSnapshot.value = snapshot;
        const agentNode = snapshot.nodes.find(n => n.type === 'agent');
        console.log(`📸 [SNAPSHOT ${snapshotCount.value}] Agent tools:`, agentNode?.data?.tools || 'none');
    });

    // Bridge events to subscriber
    globalEventService.on('*', (eventType: string, data: any) => {
        console.log(`🌉 [BRIDGE] Forwarding event: ${eventType}`);
        subscriber.handleEvent(eventType, data);
    });

    // Create agent with global event service
    const agent = new Robota({
        name: 'TestAgent',
        systemPrompt: 'You are a test agent',
        temperature: 0,
        aiProviders: [provider],
        defaultModel: { provider: 'openai', model: 'gpt-4o-mini' },
        tools: [],
        eventService: globalEventService
    });

    // Wait for initial agent creation
    await new Promise(resolve => setTimeout(resolve, 100));

    console.log('\n🔧 Before updateTools:');
    const configBefore = await agent.getConfiguration();
    console.log('- Tools:', configBefore.tools?.length || 0);
    console.log('- Version:', configBefore.configVersion);
    console.log('- Snapshots so far:', snapshotCount.value);

    // Update tools
    console.log('\n📝 Calling updateTools...');
    const updateResult = await agent.updateTools([echoTool]);
    console.log('- Update result:', updateResult);

    // Wait for event processing
    await new Promise(resolve => setTimeout(resolve, 100));

    console.log('\n🔧 After updateTools:');
    const configAfter = await agent.getConfiguration();
    console.log('- Tools:', configAfter.tools?.length || 0, configAfter.tools?.map(t => (t as any).schema?.name || 'unknown'));
    console.log('- Version:', configAfter.configVersion);
    console.log('- Total snapshots:', snapshotCount.value);

    // Check final snapshot
    if (lastSnapshot.value) {
        const agentNode = lastSnapshot.value.nodes.find((n: any) => n.type === 'agent');
        console.log('\n📸 Final snapshot agent node:');
        console.log('- Node ID:', agentNode?.id);
        console.log('- Tools in data:', agentNode?.data?.tools);
        console.log('- ConfigVersion in data:', agentNode?.data?.configVersion);
    }

    // Save snapshot for inspection
    const outputFile = path.join(__dirname, 'data', 'config-update-snapshot.json');
    await fs.writeFile(outputFile, JSON.stringify(lastSnapshot.value, null, 2));
    console.log(`\n💾 Snapshot saved to: ${outputFile}`);
}

testConfigUpdateSnapshot().catch(console.error);
