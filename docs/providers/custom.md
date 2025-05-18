# Creating Custom Providers

You can create a custom provider to integrate your own AI service or a service that isn't supported. Robota offers a flexible abstraction layer to easily integrate various AI models and services.

## Basic Implementation

To create a custom provider, extend the `BaseProvider` class and implement the necessary methods.

```typescript
import { BaseProvider, ProviderResponse, ProviderOptions, ModelContext } from 'robota';

interface CustomProviderOptions extends ProviderOptions {
  model: string;
  client: any; // Custom API client type
  // Additional options
}

export class CustomProvider extends BaseProvider {
  private client: any;
  
  constructor(options: CustomProviderOptions) {
    super(options);
    
    if (!options.client) {
      throw new Error('Client instance is required.');
    }
    
    this.client = options.client;
  }

  async generateCompletion(
    context: ModelContext, 
    options?: Partial<ProviderOptions>
  ): Promise<ProviderResponse> {
    // Convert context and messages to a format the API understands
    const messages = this.formatMessages(context.messages);
    
    // Implement API call
    const response = await this.client.generateCompletion({
      messages,
      model: options?.model || this.options.model,
      temperature: options?.temperature || this.options.temperature,
      // Additional parameters
    });
    
    // Convert API response to standard format
    return {
      content: response.text,
      usage: {
        promptTokens: response.usage?.prompt_tokens || 0,
        completionTokens: response.usage?.completion_tokens || 0,
        totalTokens: response.usage?.total_tokens || 0
      }
    };
  }

  async generateCompletionStream(
    context: ModelContext, 
    options?: Partial<ProviderOptions>
  ): Promise<ProviderResponseStream> {
    // Implement streaming API call
    const stream = await this.client.generateCompletionStream({
      messages: this.formatMessages(context.messages),
      model: options?.model || this.options.model,
      // Additional parameters
    });
    
    // Process and convert stream
    return this.processStream(stream);
  }
  
  // Helper method: Convert messages format
  private formatMessages(messages: any[]) {
    // Convert Robota message format to API format
    return messages.map(msg => {
      // Conversion logic
      return {
        role: msg.role,
        content: msg.content
        // Additional conversion
      };
    });
  }
  
  // Helper method: Process stream
  private async *processStream(apiStream: any): AsyncGenerator<ProviderResponse> {
    for await (const chunk of apiStream) {
      yield {
        content: chunk.text || '',
        // Additional data
      };
    }
  }

  // Function schema conversion (optional)
  transformFunctionSchemas(functions: any[]): any {
    // Convert function schemas to a format the API understands
    return functions.map(fn => {
      // Conversion logic
      return {
        name: fn.name,
        description: fn.description,
        parameters: fn.parameters
        // Additional conversion
      };
    });
  }

  // Check feature support
  supportsFeature(feature: string): boolean {
    switch (feature) {
      case 'function-calling':
        return true; // Support for function calling
      case 'streaming':
        return true; // Support for streaming
      default:
        return false;
    }
  }
}
```

## Usage Example

How to use a custom provider in Robota after creating it:

```typescript
import { Robota } from 'robota';
import { CustomProvider } from './custom-provider';
import { CustomClient } from 'custom-client-library';

// Create custom client
const client = new CustomClient({
  apiKey: process.env.CUSTOM_API_KEY,
  // Additional configuration
});

// Initialize custom provider
const provider = new CustomProvider({
  model: 'custom-model-v1',
  temperature: 0.7,
  client: client
});

// Connect provider to Robota instance
const robota = new Robota({ provider });

// Execute
const result = await robota.run('Hello! I am testing the custom model.');
console.log(result);
```

## Additional Considerations

### 1. Error Handling

Implement robust error handling to properly handle API errors:

```typescript
async generateCompletion(context, options) {
  try {
    // API call...
  } catch (error) {
    if (error.statusCode === 429) {
      throw new Error('API rate limit reached. Try again later.');
    } else if (error.statusCode === 401) {
      throw new Error('Authentication failed. Check your API key.');
    } else {
      throw new Error(`Error during API call: ${error.message}`);
    }
  }
}
```

### 2. Function Calling Support

To support function calling, implement appropriate conversion logic:

```typescript
// If the API supports function calling
async generateCompletion(context, options) {
  // ... code for preparing messages, etc.
  
  // Add function schemas
  if (context.functions && context.functions.length > 0) {
    apiRequest.functions = this.transformFunctionSchemas(context.functions);
    apiRequest.function_call = options?.functionCallMode || this.options.functionCallMode;
  }
  
  // API call and response
  // ...
  
  // Handle function call
  if (apiResponse.function_call) {
    return {
      content: apiResponse.content,
      functionCall: {
        name: apiResponse.function_call.name,
        arguments: JSON.parse(apiResponse.function_call.arguments)
      },
      // ... other response fields
    };
  }
  
  return { content: apiResponse.content };
}
```

### 3. Streaming Response Handling

Processing streaming responses may vary by API:

```typescript
private async *processStream(apiStream) {
  let aggregatedContent = '';
  
  try {
    for await (const chunk of apiStream) {
      const content = chunk.text || chunk.choices?.[0]?.delta?.content || '';
      aggregatedContent += content;
      
      yield {
        content,
        aggregatedContent,
        // Additional metadata
      };
    }
  } catch (error) {
    throw new Error(`Error processing stream: ${error.message}`);
  }
}
```

## Testing and Debugging

Advice for testing and debugging custom providers:

1. **Unit Tests**: Write unit tests for key methods.
2. **Use Mocks**: Use mock objects to simulate API calls during testing.
3. **Incremental Development**: Start with basic functionality and incrementally add advanced features.
4. **Logging**: Enable detailed logging during development to identify issues.

## Best Practices

1. **Type Safety**: Leverage TypeScript types for maximum type safety.
2. **Error Handling**: Handle all possible error situations.
3. **Configuration Validation**: Validate all required options in the constructor.
4. **Documentation**: Add JSDoc comments to document your code.
5. **Consider Caching**: Cache API responses where appropriate to reduce costs. 