/**
 * 02-openai-functions.ts
 * 
 * This example demonstrates how to integrate Robota with OpenAI function calling features:
 * - Use OpenAI Function Calling API directly
 * - Integrate with Robota's tool system
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
        console.log("===== OpenAI Function Calling Integration Example =====");

        // Check API key
        const apiKey = process.env.OPENAI_API_KEY;
        if (!apiKey) {
            throw new Error('OPENAI_API_KEY environment variable is required');
        }

        // Create OpenAI client
        const openaiClient = new OpenAI({ apiKey });

        // Define weather API tool
        const weatherTool = {
            name: 'getWeather',
            description: 'Retrieve current weather information for a specific location',
            parameters: z.object({
                location: z.string().describe('City name to check weather'),
                unit: z.enum(['celsius', 'fahrenheit']).optional().default('celsius').describe('Temperature unit')
            }),
            handler: async (params: { [key: string]: any }) => {
                const location = params.location;
                const unit = params.unit || 'celsius';
                console.log(`getWeather function called: ${location}, ${unit}`);

                // Return mock data instead of actual API call
                const weatherData: Record<string, any> = {
                    'Seoul': { temp: 22, condition: 'Clear', humidity: 65 },
                    'Busan': { temp: 25, condition: 'Partly Cloudy', humidity: 70 },
                    'Jeju': { temp: 27, condition: 'Cloudy', humidity: 80 },
                    'New York': { temp: 19, condition: 'Rainy', humidity: 75 },
                    'London': { temp: 16, condition: 'Foggy', humidity: 85 },
                    'Tokyo': { temp: 24, condition: 'Clear', humidity: 68 },
                };

                // Attempt city name matching
                const cityMatch = Object.keys(weatherData).find(
                    city => location.toLowerCase().includes(city.toLowerCase())
                );

                if (!cityMatch) {
                    return {
                        error: 'Weather information not found for this location',
                        available_cities: Object.keys(weatherData).join(', ')
                    };
                }

                const data = weatherData[cityMatch];
                const temp = unit === 'fahrenheit'
                    ? Math.round(data.temp * 9 / 5 + 32)
                    : data.temp;

                return {
                    location: cityMatch,
                    temperature: temp,
                    unit: unit === 'celsius' ? 'C' : 'F',
                    condition: data.condition,
                    humidity: data.humidity
                };
            }
        };

        // Define translation tool
        const translateTool = {
            name: 'translateText',
            description: 'Translate text to another language',
            parameters: z.object({
                text: z.string().describe('Text to translate'),
                target_language: z.string().describe('Target language (e.g., English, Korean, Japanese, Chinese, French)')
            }),
            handler: async (params: { [key: string]: any }) => {
                const text = params.text;
                const target_language = params.target_language;
                console.log(`translateText function called: "${text}" -> ${target_language}`);

                // Mock response instead of actual translation API call
                // In real implementation, translation API should be used
                return {
                    original_text: text,
                    translated_text: `[Text translated to ${target_language}: ${text}]`,
                    target_language
                };
            }
        };

        // Create tool provider
        const toolProvider = createZodFunctionToolProvider({
            tools: {
                getWeather: weatherTool,
                translateText: translateTool
            }
        });

        // Create OpenAI provider
        const aiProvider = new OpenAIProvider({
            model: 'gpt-3.5-turbo',
            client: openaiClient
        });

        // Create Robota instance
        const robota = new Robota({
            aiClient: aiProvider,
            provider: toolProvider,
            systemPrompt: 'You are a capable assistant that provides weather information and translation services. Please use appropriate tools to answer user questions.'
        });

        // Test questions
        const questions = [
            'How is the weather in Seoul today?',
            'What is the temperature in Tokyo? Please tell me in Fahrenheit.',
            'Please translate "Hello. Nice to meet you" to Korean.',
            'Tell me the weather in London and translate "Have a good day" to Japanese.'
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

        // Streaming response example
        console.log("\n----- Streaming Response Example -----");
        console.log("User: Compare the weather between Seoul and New York");
        console.log("Assistant: ");

        try {
            const stream = await robota.runStream("Compare the weather between Seoul and New York");
            for await (const chunk of stream) {
                process.stdout.write(chunk.content || "");
            }
            console.log("\n");
        } catch (err) {
            console.error("Streaming response error:", err);
        }

        console.log("===== OpenAI Function Calling Integration Example Completed =====");
    } catch (error) {
        console.error("Error occurred:", error);
    }
}

// Execute
main().catch(console.error); 