/**
 * 01-zod-function-tools.ts
 * 
 * This example demonstrates Function Tool Provider using Zod:
 * - Define function parameters using Zod schemas
 * - Create tool provider using createZodFunctionToolProvider
 * - Run agent with tools only, without AI
 */

import { z } from "zod";
import { Robota } from "@robota-sdk/core";
import { createZodFunctionToolProvider } from "@robota-sdk/tools";
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

// Define function tools based on Zod schemas
const tools = {
    // 'add' tool: Returns the sum of two numbers
    add: {
        name: "add",
        description: "Adds two numbers and returns the result.",
        parameters: z.object({
            a: z.number().describe("First number"),
            b: z.number().describe("Second number")
        }),
        handler: async (params) => {
            const { a, b } = params;
            console.log(`add function called: ${a} + ${b}`);
            return { result: a + b };
        }
    },

    // 'getWeather' tool: Returns weather information by city
    getWeather: {
        name: "getWeather",
        description: "Returns weather information for a city.",
        parameters: z.object({
            location: z.enum(["Seoul", "Busan", "Jeju"]).describe("City name to check weather"),
            unit: z.enum(["celsius", "fahrenheit"]).optional().default("celsius").describe("Temperature unit")
        }),
        handler: async (params) => {
            const { location, unit } = params;
            console.log(`getWeather function called: ${location}, ${unit}`);

            // Simple weather data (in real implementation, this would be API calls)
            const weatherData = {
                'Seoul': { temperature: 22, condition: 'Clear', humidity: 65 },
                'Busan': { temperature: 24, condition: 'Partly Cloudy', humidity: 70 },
                'Jeju': { temperature: 26, condition: 'Cloudy', humidity: 75 }
            };

            const data = weatherData[location];
            const temp = unit === 'fahrenheit' ? Math.round(data.temperature * 9 / 5 + 32) : data.temperature;

            return {
                temperature: temp,
                unit: unit === 'celsius' ? 'C' : 'F',
                condition: data.condition,
                humidity: data.humidity
            };
        }
    }
};

async function main() {
    try {
        console.log("Zod Function Tool Provider example started...");

        // Create Zod function tool provider
        const provider = createZodFunctionToolProvider({
            tools
        });

        // Create Robota instance (using only provider without aiClient)
        const robota = new Robota({
            provider,
            systemPrompt: "You are an AI assistant that processes user requests using tools."
        });

        // Test query examples
        const queries = [
            "Hello!",
            "Please add 5 and 7.",
            "How's the weather in Seoul right now?",
            "Tell me the weather in Jeju in Fahrenheit"
        ];

        // Process queries sequentially
        for (const query of queries) {
            console.log(`\nUser: ${query}`);
            const response = await robota.run(query);
            console.log(`Robot: ${response}`);
        }

        console.log("\nZod Function Tool Provider example completed!");
    } catch (error) {
        console.error("Error occurred:", error);
    }
}

// Execute
main().catch(console.error); 