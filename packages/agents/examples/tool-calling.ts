/**
 * Tool calling example for @robota-sdk/agents.
 *
 * Requirements:
 * - OPENAI_API_KEY
 */

import { Robota, createFunctionTool } from '@robota-sdk/agents';
import type { TToolParameters } from '@robota-sdk/agents';
import { OpenAIProvider } from '@robota-sdk/openai';

const calculateTool = createFunctionTool(
    'calculate',
    'Performs basic mathematical calculations (add, subtract, multiply, divide)',
    {
        type: 'object',
        properties: {
            operation: {
                type: 'string',
                enum: ['add', 'subtract', 'multiply', 'divide'],
                description: 'Mathematical operation to perform'
            },
            a: { type: 'number', description: 'First number' },
            b: { type: 'number', description: 'Second number' }
        },
        required: ['operation', 'a', 'b']
    },
    async (params: TToolParameters) => {
        const operation = String(params.operation);
        const a = Number(params.a);
        const b = Number(params.b);

        if (Number.isNaN(a) || Number.isNaN(b)) {
            throw new Error('Parameters a and b must be valid numbers');
        }

        let result: number;
        switch (operation) {
            case 'add': {
                result = a + b;
                break;
            }
            case 'subtract': {
                result = a - b;
                break;
            }
            case 'multiply': {
                result = a * b;
                break;
            }
            case 'divide': {
                if (b === 0) throw new Error('Division by zero is not allowed');
                result = a / b;
                break;
            }
            default: {
                throw new Error(`Unknown operation: ${operation}`);
            }
        }

        return { result, description: `${a} ${operation} ${b} = ${result}` };
    }
);

async function main(): Promise<void> {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
        throw new Error('OPENAI_API_KEY environment variable is required');
    }

    const robota = new Robota({
        name: 'ToolAgent',
        aiProviders: [new OpenAIProvider({ apiKey })],
        defaultModel: {
            provider: 'openai',
            model: 'gpt-4o-mini',
            systemMessage:
                'You are a helpful assistant that can perform calculations. ' +
                'When using tools, use the tool results to provide a complete answer.'
        },
        tools: [calculateTool]
    });

    const response = await robota.run('What is 5 plus 3?');
    // eslint-disable-next-line no-console -- examples CLI entrypoint
    console.log(response);

    await robota.destroy();
}

main().catch((error: unknown) => {
    const err = error instanceof Error ? error : new Error(String(error));
    // eslint-disable-next-line no-console -- examples CLI entrypoint
    console.error(err.message);
    process.exit(1);
});


