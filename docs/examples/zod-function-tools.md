# Zod Function Tools

This example demonstrates how to create type-safe function tools using Zod schemas, enabling robust parameter validation and function-only operation modes.

## Overview

The Zod function tools example shows how to:
- Define function tools with comprehensive Zod schemas
- Create type-safe parameter validation
- Run function-only operations without AI providers
- Implement multiple tool types in a single provider
- Handle complex data structures and enums

## Source Code

**Location**: `apps/examples/02-functions/01-zod-function-tools.ts`

## Key Concepts

### 1. Advanced Zod Schema Definition
```typescript
import { z } from "zod";

const tools = {
    // Mathematical operations with strict typing
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

    // Complex enum-based tool with optional parameters
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

            // Mock weather data (replace with real API calls)
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
```

### 2. Function-Only Provider Setup
```typescript
import { createZodFunctionTool } from "@robota-sdk/agents";
import { Robota } from "@robota-sdk/agents";

// Create tools using createZodFunctionTool
const addTool = createZodFunctionTool(
    'add',
    'Add two numbers together',
    addSchema,
    async (params) => {
        const result = params.a + params.b;
        console.log(`add function called: ${params.a} + ${params.b}`);
        return { result };
    }
);

const weatherTool = createZodFunctionTool(
    'getWeather',
    'Get weather information for a city',
    weatherSchema,
    async (params) => {
        console.log(`getWeather function called: ${params.city}, ${params.unit}`);

        // Mock weather data
        const weatherData = {
            Seoul: { temp: 22, condition: 'Clear', humidity: 65 },
            Busan: { temp: 25, condition: 'Sunny', humidity: 70 },
            Jeju: { temp: 26, condition: 'Cloudy', humidity: 75 }
        };
        
        const data = weatherData[params.city] || { temp: 20, condition: 'Unknown', humidity: 60 };
        const temp = params.unit === 'fahrenheit' ? (data.temp * 9/5) + 32 : data.temp;
        const unit = params.unit === 'fahrenheit' ? '°F' : '°C';
        
        return {
            city: params.city,
            temperature: `${temp}${unit}`,
            condition: data.condition,
            humidity: `${data.humidity}%`
        };
    }
);

// Create Robota instance with tools
const robota = new Robota({
    name: 'ToolAgent',
    aiProviders: [openaiProvider],
    defaultModel: {
        provider: 'openai',
        model: 'gpt-4',
        systemMessage: 'You are an AI assistant that processes user requests using tools.'
    },
    tools: [addTool, weatherTool]
});
```

## Running the Example

1. **Ensure setup is complete** (see [Setup Guide](./setup.md))

2. **Navigate to examples directory**:
   ```bash
   cd apps/examples
   ```

3. **Run the example**:
   ```bash
   # Using bun (recommended)
   bun run 02-functions/01-zod-function-tools.ts
   
   # Using pnpm + tsx
   pnpm tsx 02-functions/01-zod-function-tools.ts
   ```

## Expected Output

```
Zod Function Tool Provider example started...

User: Hello!
Robot: Hello! I'm an AI assistant that can help you with calculations and weather information. I can add numbers together and provide weather information for Seoul, Busan, or Jeju. How can I help you today?

User: Please add 5 and 7.
add function called: 5 + 7
Robot: I'll add 5 and 7 for you. The result is 12.

User: How's the weather in Seoul right now?
getWeather function called: Seoul, celsius
Robot: Here's the current weather information for Seoul:
- Temperature: 22°C
- Condition: Clear
- Humidity: 65%

User: Tell me the weather in Jeju in Fahrenheit
getWeather function called: Jeju, fahrenheit
Robot: Here's the weather information for Jeju in Fahrenheit:
- Temperature: 79°F
- Condition: Cloudy
- Humidity: 75%

Zod Function Tool Provider example completed!
```

## Advanced Zod Patterns

### 1. Complex Data Structures
```typescript
const dataAnalysisTool = {
    name: "analyzeData",
    description: "Analyzes complex datasets",
    parameters: z.object({
        dataset: z.array(z.object({
            id: z.string(),
            value: z.number(),
            category: z.enum(["A", "B", "C"]),
            timestamp: z.string().datetime()
        })).min(1).max(1000),
        analysisType: z.enum(["summary", "trends", "outliers"]),
        options: z.object({
            includeStats: z.boolean().default(true),
            precision: z.number().min(0).max(10).default(2)
        }).optional()
    }),
    handler: async ({ dataset, analysisType, options = {} }) => {
        const { includeStats = true, precision = 2 } = options;
        
        switch (analysisType) {
            case "summary":
                const total = dataset.reduce((sum, item) => sum + item.value, 0);
                const average = total / dataset.length;
                
                return {
                    type: "summary",
                    count: dataset.length,
                    total: Number(total.toFixed(precision)),
                    average: Number(average.toFixed(precision)),
                    ...(includeStats && {
                        categories: dataset.reduce((acc, item) => {
                            acc[item.category] = (acc[item.category] || 0) + 1;
                            return acc;
                        }, {})
                    })
                };
                
            case "trends":
                // Implement trend analysis
                return { type: "trends", message: "Trend analysis completed" };
                
            case "outliers":
                // Implement outlier detection
                return { type: "outliers", message: "Outlier detection completed" };
        }
    }
};
```

### 2. Validation with Custom Logic
```typescript
const validatedCalculatorTool = {
    name: "validateCalculate",
    description: "Calculator with comprehensive validation",
    parameters: z.object({
        operation: z.enum(["add", "subtract", "multiply", "divide", "power"]),
        operands: z.array(z.number())
            .min(2, "At least 2 numbers required")
            .max(10, "Maximum 10 numbers allowed")
            .refine(
                (numbers) => numbers.every(n => Number.isFinite(n)),
                "All numbers must be finite"
            ),
        precision: z.number().min(0).max(15).default(2)
    }).refine(
        (data) => {
            if (data.operation === "divide" && data.operands.includes(0) && data.operands.indexOf(0) > 0) {
                return false; // Division by zero
            }
            return true;
        },
        "Division by zero is not allowed"
    ),
    handler: async ({ operation, operands, precision }) => {
        let result: number;
        
        switch (operation) {
            case "add":
                result = operands.reduce((sum, num) => sum + num, 0);
                break;
            case "subtract":
                result = operands.reduce((diff, num, index) => index === 0 ? num : diff - num);
                break;
            case "multiply":
                result = operands.reduce((product, num) => product * num, 1);
                break;
            case "divide":
                result = operands.reduce((quotient, num, index) => index === 0 ? num : quotient / num);
                break;
            case "power":
                result = Math.pow(operands[0], operands[1]);
                break;
        }
        
        return {
            operation,
            operands,
            result: Number(result.toFixed(precision)),
            precision
        };
    }
};
```

### 3. File Processing Tool
```typescript
const fileProcessorTool = {
    name: "processFile",
    description: "Processes file-like data structures",
    parameters: z.object({
        fileInfo: z.object({
            name: z.string().min(1),
            extension: z.enum([".txt", ".json", ".csv", ".md"]),
            size: z.number().positive(),
            content: z.string()
        }),
        operations: z.array(z.enum([
            "count_lines",
            "count_words", 
            "count_characters",
            "extract_metadata",
            "validate_format"
        ])).min(1),
        outputFormat: z.enum(["summary", "detailed", "json"]).default("summary")
    }),
    handler: async ({ fileInfo, operations, outputFormat }) => {
        const results = {};
        
        for (const operation of operations) {
            switch (operation) {
                case "count_lines":
                    results["lineCount"] = fileInfo.content.split('\n').length;
                    break;
                case "count_words":
                    results["wordCount"] = fileInfo.content.split(/\s+/).filter(word => word.length > 0).length;
                    break;
                case "count_characters":
                    results["characterCount"] = fileInfo.content.length;
                    break;
                case "extract_metadata":
                    results["metadata"] = {
                        fileName: fileInfo.name,
                        extension: fileInfo.extension,
                        fileSize: fileInfo.size
                    };
                    break;
                case "validate_format":
                    results["isValid"] = fileInfo.content.length === fileInfo.size;
                    break;
            }
        }
        
        return {
            file: fileInfo.name,
            operations: operations,
            results: results,
            format: outputFormat
        };
    }
};
```

## Function-Only Architecture Benefits

### 1. No AI Provider Required
```typescript
// Can run without any AI provider setup
const functionOnlyRobota = new Robota({
    tools: [addTool, weatherTool],
    systemPrompt: "Function-only mode"
});

// Direct function execution
const result = await functionOnlyRobota.run("Add 10 and 20");
```

### 2. Deterministic Behavior
```typescript
// Predictable, rule-based responses
const ruleBased = {
    name: "processCommand",
    parameters: z.object({
        command: z.enum(["status", "help", "version"]),
        args: z.array(z.string()).optional()
    }),
    handler: async ({ command, args = [] }) => {
        switch (command) {
            case "status":
                return { status: "operational", timestamp: new Date().toISOString() };
            case "help":
                return { help: "Available commands: status, help, version" };
            case "version":
                return { version: "1.0.0", build: "20241201" };
        }
    }
};
```

### 3. Performance Benefits
- Faster execution (no AI API calls)
- Predictable latency
- No token costs
- Offline capability

## Testing and Validation

### 1. Schema Testing
```typescript
import { z } from "zod";

// Test schema validation
const testSchema = z.object({
    value: z.number().positive(),
    name: z.string().min(1)
});

// Valid input
const validData = { value: 42, name: "test" };
const result = testSchema.safeParse(validData);
console.log(result.success); // true

// Invalid input
const invalidData = { value: -1, name: "" };
const errorResult = testSchema.safeParse(invalidData);
console.log(errorResult.success); // false
console.log(errorResult.error.issues); // Detailed error info
```

### 2. Handler Testing
```typescript
async function testTool() {
    const tool = tools.add;
    
    // Test normal operation
    const result1 = await tool.handler({ a: 5, b: 3 });
    console.assert(result1.result === 8);
    
    // Test edge cases
    const result2 = await tool.handler({ a: 0, b: 0 });
    console.assert(result2.result === 0);
    
    console.log("All tests passed!");
}
```

## Best Practices

### 1. Schema Design
```typescript
// Good: Descriptive and well-constrained
z.object({
    temperature: z.number()
        .min(-273.15, "Temperature cannot be below absolute zero")
        .max(1000, "Temperature too high")
        .describe("Temperature in Celsius"),
    unit: z.enum(["C", "F", "K"])
        .describe("Temperature unit")
})

// Avoid: Overly permissive
z.object({
    temp: z.any(),
    unit: z.string()
})
```

### 2. Error Handling
```typescript
const robustHandler = async (params) => {
    try {
        // Validate business logic
        if (params.amount <= 0) {
            return { 
                success: false, 
                error: "Amount must be positive",
                code: "INVALID_AMOUNT" 
            };
        }
        
        // Process
        const result = await processData(params);
        
        return { 
            success: true, 
            data: result 
        };
    } catch (error) {
        return { 
            success: false, 
            error: error.message,
            code: "PROCESSING_ERROR" 
        };
    }
};
```

### 3. Documentation
```typescript
const wellDocumentedTool = {
    name: "calculateInterest",
    description: "Calculates compound interest for financial planning",
    parameters: z.object({
        principal: z.number()
            .positive("Principal amount must be positive")
            .describe("Initial investment amount in dollars"),
        rate: z.number()
            .min(0).max(1)
            .describe("Annual interest rate as decimal (e.g., 0.05 for 5%)"),
        time: z.number()
            .positive("Time period must be positive")
            .describe("Investment period in years"),
        compoundFrequency: z.number()
            .int().positive()
            .default(12)
            .describe("Number of times interest compounds per year")
    }),
    handler: async ({ principal, rate, time, compoundFrequency }) => {
        const amount = principal * Math.pow(1 + rate / compoundFrequency, compoundFrequency * time);
        const interest = amount - principal;
        
        return {
            principal,
            finalAmount: Number(amount.toFixed(2)),
            interestEarned: Number(interest.toFixed(2)),
            rate: rate * 100, // Convert to percentage for display
            years: time
        };
    }
};
```

## Next Steps

After mastering Zod function tools, explore:

1. [**Custom Function Providers**](./custom-function-providers.md) - Building custom tool providers
2. [**AI with Tools**](./ai-with-tools.md) - Combining with AI providers
3. [**MCP Integration**](./mcp-integration.md) - Model Context Protocol tools

## Troubleshooting

### Schema Validation Errors
```typescript
// Debug schema issues
const result = schema.safeParse(data);
if (!result.success) {
    console.log("Validation errors:", result.error.format());
}
```

### Type Safety Issues
```typescript
// Ensure proper typing
type ToolParams = z.infer<typeof toolSchema>;
const handler = async (params: ToolParams) => {
    // params is fully typed
};
```

### Performance Optimization
- Use `.optional()` and `.default()` for better UX
- Implement caching for expensive operations
- Consider lazy validation for large datasets 