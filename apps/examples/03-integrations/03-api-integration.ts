/**
 * 03-api-integration.ts
 * 
 * This example demonstrates how to integrate Robota with external APIs:
 * - Implementing tools for external API calls
 * - Processing API results and generating responses
 */

import { Robota } from '@robota-sdk/core';
import { OpenAIProvider } from '@robota-sdk/openai';
import { createZodFunctionToolProvider } from '@robota-sdk/tools';
import OpenAI from 'openai';
import { z } from 'zod';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

async function main() {
    try {
        console.log("===== External API Integration Example =====");

        // Check API key
        const apiKey = process.env.OPENAI_API_KEY;
        if (!apiKey) {
            throw new Error('OPENAI_API_KEY environment variable is required');
        }

        // Create OpenAI client
        const openaiClient = new OpenAI({ apiKey });

        // Define exchange rate API tool
        const exchangeRateTool = {
            name: 'getExchangeRate',
            description: 'Get exchange rate information between two currencies',
            parameters: z.object({
                from_currency: z.string().describe('Source currency code (e.g., USD, EUR, KRW)'),
                to_currency: z.string().describe('Target currency code (e.g., USD, EUR, KRW)'),
                amount: z.number().optional().describe('Amount to convert (default: 1)')
            }),
            handler: async (params: { [key: string]: any }) => {
                const from = params.from_currency.toUpperCase();
                const to = params.to_currency.toUpperCase();
                const amount = params.amount || 1;

                console.log(`Fetching exchange rate: ${from} -> ${to}, amount: ${amount}`);

                try {
                    // Mock exchange rate data (in real implementation, call actual API)
                    const exchangeRates: Record<string, Record<string, number>> = {
                        'USD': { 'EUR': 0.92, 'KRW': 1350.45, 'JPY': 154.32, 'GBP': 0.78 },
                        'EUR': { 'USD': 1.09, 'KRW': 1470.23, 'JPY': 168.75, 'GBP': 0.85 },
                        'KRW': { 'USD': 0.00074, 'EUR': 0.00068, 'JPY': 0.113, 'GBP': 0.00058 },
                        'JPY': { 'USD': 0.0065, 'EUR': 0.0059, 'KRW': 8.85, 'GBP': 0.0051 },
                        'GBP': { 'USD': 1.28, 'EUR': 1.17, 'KRW': 1730.25, 'JPY': 196.45 }
                    };

                    if (!exchangeRates[from] || !exchangeRates[from][to]) {
                        return {
                            error: `Unsupported currency conversion: ${from} -> ${to}`,
                            supported_currencies: Object.keys(exchangeRates).join(', ')
                        };
                    }

                    const rate = exchangeRates[from][to];
                    const convertedAmount = amount * rate;

                    return {
                        from_currency: from,
                        to_currency: to,
                        exchange_rate: rate,
                        amount: amount,
                        converted_amount: convertedAmount
                    };
                } catch (error) {
                    return { error: `Exchange rate fetch failed: ${(error as Error).message}` };
                }
            }
        };

        // Define stock quote API tool
        const stockQuoteTool = {
            name: 'getStockQuote',
            description: 'Get current stock price for a given symbol',
            parameters: z.object({
                symbol: z.string().describe('Stock symbol (e.g., AAPL, MSFT, GOOG)'),
                include_details: z.boolean().optional().default(false).describe('Whether to include additional details')
            }),
            handler: async (params: { [key: string]: any }) => {
                const symbol = params.symbol.toUpperCase();
                const includeDetails = params.include_details || false;

                console.log(`Fetching stock quote: ${symbol}, details: ${includeDetails}`);

                try {
                    // Mock stock data (in real implementation, call actual stock API)
                    const stocks: Record<string, any> = {
                        'AAPL': { price: 182.63, change: 1.25, change_percent: 0.69, volume: 52_500_000, company: 'Apple Inc.' },
                        'MSFT': { price: 410.34, change: -2.45, change_percent: -0.59, volume: 28_300_000, company: 'Microsoft Corporation' },
                        'GOOG': { price: 159.13, change: 0.87, change_percent: 0.55, volume: 18_900_000, company: 'Alphabet Inc.' },
                        'AMZN': { price: 178.15, change: 3.21, change_percent: 1.83, volume: 41_200_000, company: 'Amazon.com Inc.' },
                        'META': { price: 474.99, change: -8.32, change_percent: -1.72, volume: 16_800_000, company: 'Meta Platforms Inc.' },
                        'TSLA': { price: 247.85, change: 5.67, change_percent: 2.34, volume: 89_600_000, company: 'Tesla, Inc.' }
                    };

                    if (!stocks[symbol]) {
                        return {
                            error: `Stock symbol not found: ${symbol}`,
                            available_symbols: Object.keys(stocks).join(', ')
                        };
                    }

                    const stockData = stocks[symbol];

                    // Return basic information
                    const result: Record<string, any> = {
                        symbol: symbol,
                        price: stockData.price,
                        change: stockData.change,
                        change_percent: stockData.change_percent,
                        company: stockData.company
                    };

                    // Include additional details if requested
                    if (includeDetails) {
                        result.volume = stockData.volume;
                        result.market_cap = Math.round(stockData.price * (stockData.volume * 10));
                        result.pe_ratio = (stockData.price / (stockData.price / 20 + Math.random() * 5)).toFixed(2);
                        result.dividend_yield = (Math.random() * 2).toFixed(2) + '%';
                    }

                    return result;
                } catch (error) {
                    return { error: `Stock quote fetch failed: ${(error as Error).message}` };
                }
            }
        };

        // Create tool provider
        const toolProvider = createZodFunctionToolProvider({
            tools: {
                getExchangeRate: exchangeRateTool,
                getStockQuote: stockQuoteTool
            }
        });

        // Create OpenAI provider
        const aiProvider = new OpenAIProvider({
            model: 'gpt-3.5-turbo',
            client: openaiClient
        });

        // Create Robota instance
        const robota = new Robota({
            aiProviders: { 'openai': aiProvider },
            currentProvider: 'openai',
            currentModel: 'gpt-3.5-turbo',
            toolProviders: [toolProvider],
            systemPrompt: 'You are a financial information assistant. Use appropriate tools to provide accurate exchange rate and stock information in response to user questions.'
        });

        // Test questions
        const questions = [
            'How much is 1 USD in KRW?',
            'What is 100 EUR in USD?',
            'What is the current Apple stock price?',
            'Compare Tesla and Microsoft stock prices',
            'Tell me everything about Apple stock'
        ];

        // Process questions sequentially
        for (const question of questions) {
            console.log(`\nUser: ${question}`);
            try {
                const response = await robota.run(question);
                console.log(`Assistant: ${response}`);
            } catch (err) {
                console.error(`Error occurred: ${err}`);
            }
        }

        // Streaming example
        console.log("\n----- Streaming Response Example -----");
        console.log("User: Compare Apple and Google stocks and calculate how much $1000 would be in KRW.");
        console.log("Assistant: ");

        try {
            const stream = await robota.runStream("Compare Apple and Google stocks and calculate how much $1000 would be in KRW.");
            for await (const chunk of stream) {
                process.stdout.write(chunk.content || "");
            }
            console.log('\n');
        } catch (err) {
            console.error("Streaming response error:", err);
        }

        console.log("===== External API Integration Example Complete =====");
    } catch (error) {
        console.error("Error occurred:", error);
    }
}

// Execute
main().catch(console.error); 