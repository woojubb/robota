const { OpenAIConversationAdapter } = require('./packages/openai/dist/index.cjs');

// Test messages with tool message
const testMessages = [
    {
        role: 'user',
        content: 'Calculate 5 * 7',
        timestamp: new Date()
    },
    {
        role: 'assistant',
        content: 'I will calculate that for you.',
        functionCall: {
            name: 'calculate',
            arguments: { operation: 'multiply', a: 5, b: 7 }
        },
        timestamp: new Date()
    },
    {
        role: 'tool',
        content: JSON.stringify({ result: 35 }),
        name: 'calculate',
        toolResult: {
            name: 'calculate',
            result: { result: 35 }
        },
        timestamp: new Date()
    }
];

console.log('Original messages:', testMessages.length);
testMessages.forEach((msg, i) => {
    console.log(`${i}: ${msg.role}`);
});

console.log('\n--- Filtering test ---');
const filtered = testMessages.filter(msg => msg.role !== 'tool');
console.log('After filter:', filtered.length);
filtered.forEach((msg, i) => {
    console.log(`${i}: ${msg.role}`);
});

console.log('\n--- OpenAI Adapter test ---');
try {
    const openaiMessages = OpenAIConversationAdapter.toOpenAIFormat(testMessages);
    console.log('OpenAI messages:', openaiMessages.length);
    openaiMessages.forEach((msg, i) => {
        console.log(`${i}: ${msg.role}`);
    });
} catch (error) {
    console.error('Error:', error.message);
} 