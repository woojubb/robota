import { McpServer } from "@modelcontextprotocol/sdk/dist/esm/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/dist/esm/server/stdio.js";
import { z } from "zod";

// Create MCP server instance
const server = new McpServer({
    name: "Demo Server",
    version: "1.0.0"
});

// Add 'add' tool: returns the sum of two numbers
server.tool(
    "add",
    "Add two numbers and return the result.",
    {
        a: z.number().describe("First number"),
        b: z.number().describe("Second number")
    },
    async ({ a, b }: { a: number; b: number }) => ({
        content: [{ type: "text", text: `Result: ${a + b}` }]
    })
);

// Add 'getWeather' tool: returns weather information based on location
server.tool(
    "getWeather",
    "Get weather information for a given city name and unit.",
    {
        location: z.enum(["Seoul", "Busan", "Jeju"]).describe("City name to check weather"),
        unit: z.enum(["celsius", "fahrenheit"]).optional().default("celsius").describe("Temperature unit")
    },
    async ({ location, unit }: { location: "Seoul" | "Busan" | "Jeju"; unit?: "celsius" | "fahrenheit" }) => {
        // Simple weather data
        const weatherData = {
            'Seoul': { temperature: 22, condition: 'Clear', humidity: 65 },
            'Busan': { temperature: 24, condition: 'Partly Cloudy', humidity: 70 },
            'Jeju': { temperature: 26, condition: 'Cloudy', humidity: 75 }
        };

        const data = weatherData[location] || { temperature: 20, condition: 'No Data', humidity: 50 };
        const temp = unit === 'fahrenheit' ? Math.round(data.temperature * 9 / 5 + 32) : data.temperature;

        return {
            content: [{
                type: "text",
                text: `Weather in ${location}: ${temp}°${unit === 'celsius' ? 'C' : 'F'}, ${data.condition}, Humidity ${data.humidity}%`
            }]
        };
    }
);

// Start server using STDIO transport
const transport = new StdioServerTransport();

// Main function
async function main() {
    try {
        console.error('Starting MCP server...');
        await server.connect(transport);
        console.error('STDIO MCP server started.');
        console.error('Press Ctrl+C to exit.');
    } catch (error) {
        console.error('Error starting server:', error);
        process.exit(1);
    }
}

// Process termination handling
process.on('SIGINT', () => {
    console.log('\nShutting down server...');
    process.exit(0);
});

process.on('SIGTERM', () => {
    console.log('\nShutting down server...');
    process.exit(0);
});

// Run the program
main().catch(console.error); 