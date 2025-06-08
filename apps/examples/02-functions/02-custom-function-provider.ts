/**
 * 02-custom-function-provider.ts
 * 
 * This example demonstrates how to implement a custom function provider:
 * - Extend BaseToolProvider for common functionality
 * - Convert functions to JSON Schema
 * - Use with OpenAI
 */

import { Robota } from "@robota-sdk/core";
import { OpenAIProvider } from "@robota-sdk/openai";
import { BaseToolProvider, type FunctionSchema } from "@robota-sdk/tools";
import OpenAI from "openai";
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

// JSON Schema type definition
type JSONSchema = {
    type: string;
    properties?: Record<string, any>;
    required?: string[];
    [key: string]: any;
};

/**
 * Custom function tool provider class
 * Extends BaseToolProvider for enhanced functionality
 */
class CustomFunctionToolProvider extends BaseToolProvider {
    private functionHandlers: Record<string, {
        name: string;
        description: string;
        schema: JSONSchema;
        handler: (params: any) => Promise<any>;
    }>;

    public readonly functions: FunctionSchema[];

    constructor(functions: Record<string, {
        name: string;
        description: string;
        schema: JSONSchema;
        handler: (params: any) => Promise<any>;
    }>) {
        super(); // Initialize BaseToolProvider
        this.functionHandlers = functions;

        // Convert to FunctionSchema array
        this.functions = Object.values(functions).map(fn => ({
            name: fn.name,
            description: fn.description,
            parameters: {
                type: "object" as const,
                properties: fn.schema.properties || {},
                required: fn.schema.required
            }
        }));
    }

    /**
     * Tool call implementation using BaseToolProvider's error handling
     */
    async callTool(name: string, params: any): Promise<any> {
        return this.executeToolSafely(name, params, async () => {
            const fn = this.functionHandlers[name];
            if (!fn) {
                throw new Error(`Function definition not found.`);
            }

            console.log(`Function '${name}' called:`, params);
            return await fn.handler(params);
        });
    }

    /**
     * Check if tool exists (override)
     */
    hasTool(toolName: string): boolean {
        return toolName in this.functionHandlers;
    }
}

async function main() {
    try {
        // Check API key
        const apiKey = process.env.OPENAI_API_KEY;
        if (!apiKey) {
            throw new Error('OPENAI_API_KEY environment variable is required');
        }

        // Create OpenAI client
        const openaiClient = new OpenAI({
            apiKey
        });

        // Define custom functions
        const customFunctions = {
            fetchStockPrice: {
                name: 'fetchStockPrice',
                description: 'Fetch current stock price',
                schema: {
                    type: 'object',
                    properties: {
                        symbol: {
                            type: 'string',
                            description: 'Stock symbol (e.g., AAPL, MSFT, GOOG)'
                        }
                    },
                    required: ['symbol']
                },
                handler: async (params: { symbol: string }) => {
                    const { symbol } = params;
                    // In reality, this would be an API call, here using example data
                    const stockPrices: Record<string, number> = {
                        'AAPL': 182.63,
                        'MSFT': 410.34,
                        'GOOG': 159.13,
                        'AMZN': 178.15,
                        'META': 474.99
                    };

                    const price = stockPrices[symbol.toUpperCase()] || Math.random() * 1000;
                    return { symbol: symbol.toUpperCase(), price, currency: 'USD' };
                }
            },

            convertCurrency: {
                name: 'convertCurrency',
                description: 'Convert amount between currencies',
                schema: {
                    type: 'object',
                    properties: {
                        amount: {
                            type: 'number',
                            description: 'Amount to convert'
                        },
                        from: {
                            type: 'string',
                            description: 'Source currency (e.g., USD, EUR, KRW)'
                        },
                        to: {
                            type: 'string',
                            description: 'Target currency (e.g., USD, EUR, KRW)'
                        }
                    },
                    required: ['amount', 'from', 'to']
                },
                handler: async (params: { amount: number; from: string; to: string }) => {
                    const { amount, from, to } = params;

                    // Example exchange rate data (in reality, this would be API calls)
                    const exchangeRates: Record<string, Record<string, number>> = {
                        'USD': { 'EUR': 0.92, 'KRW': 1350.45, 'JPY': 154.32 },
                        'EUR': { 'USD': 1.09, 'KRW': 1470.23, 'JPY': 168.75 },
                        'KRW': { 'USD': 0.00074, 'EUR': 0.00068, 'JPY': 0.113 },
                        'JPY': { 'USD': 0.0065, 'EUR': 0.0059, 'KRW': 8.85 }
                    };

                    // Return as-is if same currency
                    if (from === to) {
                        return { amount, currency: to };
                    }

                    // Check exchange rate
                    if (!exchangeRates[from] || !exchangeRates[from][to]) {
                        return { error: `Unsupported currency conversion: ${from} -> ${to}` };
                    }

                    const rate = exchangeRates[from][to];
                    const convertedAmount = amount * rate;

                    return {
                        original: { amount, currency: from },
                        converted: { amount: convertedAmount, currency: to },
                        rate: rate
                    };
                }
            }
        };

        // Create custom function provider using the new BaseToolProvider
        const customProvider = new CustomFunctionToolProvider(customFunctions);

        // Create OpenAI provider
        const openaiProvider = new OpenAIProvider({
            model: 'gpt-3.5-turbo',
            client: openaiClient
        });

        // Create Robota instance with new API
        const robota = new Robota({
            aiProviders: {
                'openai': openaiProvider
            },
            currentProvider: 'openai',
            currentModel: 'gpt-3.5-turbo',
            toolProviders: [customProvider],
            systemPrompt: 'You are an AI assistant that provides financial information. Please use stock price and currency conversion tools to provide accurate information for user requests.'
        });

        // Test queries
        const queries = [
            "What's the current price of Apple stock?",
            "Tell me the stock prices of Microsoft and Google",
            "How much is 100 dollars in euros?",
            "How much is 5000 Korean won in dollars?"
        ];

        // Process queries sequentially
        for (const query of queries) {
            console.log(`\nUser: ${query}`);
            const response = await robota.run(query);
            console.log(`Robot: ${response}`);
        }

        console.log("\nCustom Function Provider example completed!");
    } catch (error) {
        console.error("Error occurred:", error);
    }
}

// Execute
main().catch(console.error); 