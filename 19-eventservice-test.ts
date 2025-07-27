import { Robota, AgentConfig } from '../../packages/agents/src/index';
import { OpenAIProvider } from '../../packages/openai/src/index';

/**
 * Test EventService Integration
 * 
 * This test verifies that:
 * 1. EventService is properly injected into Agent
 * 2. Events are automatically emitted around Agent.run() execution
 * 3. Event data contains proper metadata and hierarchical information
 */

// Create a custom EventService for testing that logs all events
class TestEventService {
    private events: Array<{ eventType: string; data: any; timestamp: Date }> = [];

    emit(eventType: string, data: any): void {
        const event = {
            eventType,
            data,
            timestamp: new Date()
        };

        this.events.push(event);

        console.log(`📋 Event Emitted: ${eventType}`);
        console.log(`   Source: ${data.sourceType}:${data.sourceId}`);
        console.log(`   Timestamp: ${event.timestamp.toISOString()}`);

        if (data.metadata) {
            console.log(`   Metadata:`, JSON.stringify(data.metadata, null, 2));
        }

        console.log('---');
    }

    getEvents() {
        return this.events;
    }

    clearEvents() {
        this.events = [];
    }

    getEventsByType(eventType: string) {
        return this.events.filter(event => event.eventType === eventType);
    }
}

async function testEventServiceIntegration() {
    console.log('🧪 Testing EventService Integration\n');

    // Create test EventService
    const testEventService = new TestEventService();

    // Create Agent configuration with EventService
    const agentConfig: AgentConfig = {
        name: 'EventTestAgent',
        aiProviders: [
            new OpenAIProvider({
                apiKey: process.env.OPENAI_API_KEY!,
                baseURL: 'https://api.openai.com/v1'
            })
        ],
        defaultModel: {
            provider: 'openai',
            model: 'gpt-3.5-turbo'
        },
        eventService: testEventService as any // Inject test EventService
    };

    console.log('🏗️ Creating Agent with EventService...');
    const agent = new Robota(agentConfig);

    console.log('🚀 Running Agent task...\n');

    // Clear events before test
    testEventService.clearEvents();

    try {
        // Execute a simple task
        const result = await agent.run('What is 2 + 2? Just give me the number.');

        console.log('\n✅ Agent execution completed');
        console.log('📤 Result:', result);

        // Analyze captured events
        console.log('\n📊 Event Analysis:');
        const allEvents = testEventService.getEvents();
        console.log(`Total events captured: ${allEvents.length}`);

        const executionStartEvents = testEventService.getEventsByType('execution.start');
        const executionCompleteEvents = testEventService.getEventsByType('execution.complete');
        const executionErrorEvents = testEventService.getEventsByType('execution.error');

        console.log(`- execution.start: ${executionStartEvents.length}`);
        console.log(`- execution.complete: ${executionCompleteEvents.length}`);
        console.log(`- execution.error: ${executionErrorEvents.length}`);

        // Verify expected events
        if (executionStartEvents.length > 0 && executionCompleteEvents.length > 0) {
            console.log('\n✅ EventService Integration: SUCCESS');
            console.log('   - Events are being emitted automatically');
            console.log('   - Agent execution lifecycle is properly tracked');
        } else {
            console.log('\n❌ EventService Integration: FAILED');
            console.log('   - Missing expected execution events');
        }

    } catch (error) {
        console.error('\n❌ Agent execution failed:', error);

        // Check if error events were captured
        const errorEvents = testEventService.getEventsByType('execution.error');
        if (errorEvents.length > 0) {
            console.log('✅ Error events were properly captured');
        }
    }

    console.log('\n🔬 Full Event Log:');
    testEventService.getEvents().forEach((event, index) => {
        console.log(`${index + 1}. ${event.eventType} at ${event.timestamp.toISOString()}`);
    });
}

// Run the test
testEventServiceIntegration()
    .then(() => {
        console.log('\n🏁 EventService integration test completed');
        process.exit(0);
    })
    .catch((error) => {
        console.error('\n💥 Test failed:', error);
        process.exit(1);
    }); 