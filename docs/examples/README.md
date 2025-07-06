# Examples

Comprehensive examples demonstrating all aspects of the Robota SDK.

## Basic Examples

### [Basic Conversation](basic-conversation.md)
Learn the fundamentals of Robota with simple AI conversations.

**Features Demonstrated:**
- OpenAI Provider setup and configuration
- Simple message exchange using `robota.run()`
- Agent statistics and monitoring
- Proper resource cleanup

### [AI with Tools](ai-with-tools.md) 
Integrate function calling capabilities with your AI agents.

**Features Demonstrated:**
- Function tool creation with JSON schemas
- Automatic tool calling by AI agents
- Tool execution results handling
- Tool usage statistics

### [Multi-Provider Support](multi-provider.md)
Use multiple AI providers and models in a single application.

**Features Demonstrated:**
- OpenAI with different models (GPT-3.5, GPT-4o-mini)
- Model comparison and response analysis
- Independent agent instances
- Provider-specific configurations

## Advanced Features

### [Team Collaboration](team-collaboration.md)
Leverage intelligent multi-agent collaboration with template-based expert selection.

**Features Demonstrated:**
- Automatic expert template selection
- Task decomposition and delegation
- Built-in specialist templates (researchers, creative ideators, etc.)
- Workflow visualization and analytics
- Multi-provider collaboration

### [Team Templates](team-templates.md)
Use pre-built expert templates for specialized tasks.

**Features Demonstrated:**
- Template-based agent creation
- Expert template registry
- Custom template development
- Optimized AI provider selection per template

### [Execution Analytics](execution-analytics.md)
Monitor and analyze agent performance in real-time.

**Features Demonstrated:**
- Real-time performance tracking
- Execution statistics and metrics
- Error analysis and reporting
- Memory management and optimization

## Agent System

### [Agents Basic Usage](agents-basic-usage.md)
Explore the comprehensive capabilities of the unified Robota Agent system.

**Features Demonstrated:**
- Unified agent architecture with plugins
- Real-time statistics and monitoring
- Runtime configuration updates
- Plugin ecosystem integration

### [Agents Streaming](agents-streaming.md)
Implement real-time streaming responses for interactive applications.

**Features Demonstrated:**
- Real-time response streaming
- Token-by-token processing
- Performance optimization for streaming
- Memory-efficient processing

## Specialized Features

### [Session Management](session-management.md)
Manage complex conversation sessions with advanced features.

**Features Demonstrated:**
- Multi-session conversation management
- Session persistence and restoration
- Context switching between sessions

### [Conversation History](conversation-history.md)
Implement comprehensive conversation storage and retrieval.

**Features Demonstrated:**
- Memory, file, and database storage options
- Conversation search and filtering
- Message lifecycle management
- Batch processing and optimization

### [Function Calling with Zod](zod-function-tools.md)
Create type-safe function tools using Zod schemas.

**Features Demonstrated:**
- Zod schema integration
- Runtime type validation
- Type-safe parameter handling
- Schema-to-JSON conversion

### [Provider Switching](provider-switching.md)
Dynamically switch between AI providers during execution.

**Features Demonstrated:**
- Runtime provider switching
- Configuration preservation
- Fallback strategies
- Provider-specific optimizations

### [Token Limits](token-limits.md)
Implement intelligent token management and cost control.

**Features Demonstrated:**
- Token usage tracking
- Cost calculation and monitoring
- Limit enforcement strategies
- Budget management

### [MCP Integration](mcp-integration.md)
Connect to external tools using the Model Context Protocol.

**Features Demonstrated:**
- MCP client integration
- External tool discovery
- Protocol communication
- Tool schema handling

### [Module System Integration](module-system.md)
Leverage the new Plugin-Module-Separation architecture for enhanced functionality.

**Features Demonstrated:**
- Enhanced plugin classification system
- Custom module development
- Event-driven module-plugin communication
- Module registry and lifecycle management
- Performance monitoring across modules and plugins

## Configuration

### [Setup Guide](setup.md)
Complete setup instructions for all SDK components.

**Covers:**
- Environment configuration
- API key management
- Package installation
- Development setup

## Real-World Applications

Each example includes:
- ✅ **Complete working code** - Ready to run examples
- ✅ **Type safety** - Full TypeScript support
- ✅ **Error handling** - Robust error management
- ✅ **Best practices** - Production-ready patterns
- ✅ **Performance monitoring** - Built-in analytics
- ✅ **Resource management** - Proper cleanup

## Running Examples

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Configure environment:**
   ```bash
   cp .env.example .env
   # Add your API keys
   ```

3. **Run an example:**
   ```bash
   npx tsx examples/01-basic-conversation.ts
   ```

## Example Categories

### By Complexity
- **Beginner**: Basic conversation, Simple tools
- **Intermediate**: Multi-provider, Team collaboration
- **Advanced**: Custom plugins, Complex workflows

### By Use Case
- **Chatbots**: Basic conversation, Session management
- **Research**: Team collaboration, Analytics
- **Development**: Function calling, MCP integration
- **Production**: Error handling, Performance monitoring

All examples are production-ready and demonstrate best practices for building scalable AI applications with Robota SDK.

## 🚀 Getting Started

### Quick Setup

1. **Clone and Install**:
   ```bash
   git clone https://github.com/your-org/robota.git
   cd robota
   pnpm install
   ```

2. **Environment Setup**:
```bash
cd apps/examples
cp .env.example .env
   # Edit .env with your API keys
   ```

3. **Run Examples**:
   ```bash
# Run any example
npx tsx 01-basic-conversation.ts
```

## 🎯 Quick Feature Overview

### New Unified Architecture (`@robota-sdk/agents`)
The examples showcase the powerful new unified architecture:

- **Zero `any` Types**: Complete TypeScript safety
- **Plugin System**: Modular functionality with built-in plugins
- **Multi-Provider**: Seamless switching between OpenAI, Anthropic, Google
- **Advanced Analytics**: Built-in execution monitoring and performance tracking
- **Tool System**: Type-safe function calling with automatic schema conversion
- **Streaming Support**: Real-time response streaming with metadata

### Core Capabilities Demonstrated

| Feature | Examples | Description |
|---------|----------|-------------|
| **Basic AI Chat** | 01, 10 | Simple conversations and basic setup |
| **Function Calling** | 02 | Tool integration and automated function calls |
| **Multi-Provider** | 03, 07 | OpenAI, Anthropic, Google AI provider usage |
| **Streaming** | 11 | Real-time response streaming |
| **Team Coordination** | 05, 09 | Multi-agent collaboration |
| **Performance Analytics** | 08, 09 | Execution monitoring and optimization |
| **Template Patterns** | 07 | Reusable agent configurations |

## 🔧 Running Examples

### Prerequisites

```bash
# Required environment variables
OPENAI_API_KEY=your_openai_key
ANTHROPIC_API_KEY=your_anthropic_key  # For multi-provider examples
GOOGLE_AI_API_KEY=your_google_key     # For Google AI examples
```

### Individual Examples

```bash
# Navigate to examples
cd apps/examples

# Basic conversation
npx tsx 01-basic-conversation.ts

# Advanced agents features
npx tsx 10-agents-basic-usage.ts

# Streaming responses
npx tsx 11-agents-streaming.ts

# Function calling
npx tsx 02-tool-calling.ts

# Multi-provider comparison
npx tsx 03-multi-providers.ts

# Agent templates
npx tsx 07-team-templates.ts

# Performance analytics
npx tsx 08-execution-analytics.ts
```

### Run All Examples

```bash
# Run a sequence of examples to see progression
npm run examples:basic     # Basic examples (01, 02, 10)
npm run examples:advanced  # Advanced examples (03, 07, 08, 11)
npm run examples:all       # All examples in sequence
```

## 🎨 Example Structure

Each example follows a consistent structure:

```typescript
/**
 * XX-example-name.ts
 * 
 * Brief description of what this example demonstrates:
 * - Key feature 1
 * - Key feature 2
 * - Key feature 3
 */

import { /* required imports */ } from '@robota-sdk/agents';
import dotenv from 'dotenv';

dotenv.config();

async function main() {
    try {
        // Example implementation
        console.log('🚀 Example Started...');
        
        // Create agents, configure providers, demonstrate features
        
        console.log('✅ Example Completed!');
            } catch (error) {
        console.error('❌ Error:', error);
        process.exit(1);
    } finally {
        // Cleanup resources
        process.exit(0);
            }
        }

main();
```

## 📊 Performance Considerations

The examples are optimized for learning and demonstration:

- **Minimal Token Usage**: Short queries to reduce API costs
- **Error Handling**: Robust error handling and recovery
- **Resource Cleanup**: Proper cleanup to prevent memory leaks
- **Performance Monitoring**: Built-in timing and analytics

## 🔗 Related Documentation

- **[Getting Started Guide](../getting-started/README.md)** - Initial setup and basic concepts
- **[Core Concepts](../guide/core-concepts.md)** - Understanding the architecture
- **[API Reference](../api-reference/README.md)** - Complete API documentation
- **[Provider Guides](../providers/README.md)** - Provider-specific documentation

## 💡 Tips for Learning

1. **Start Simple**: Begin with basic conversation example
2. **Read Comments**: Each example has detailed inline comments
3. **Experiment**: Modify examples to explore different configurations
4. **Check Output**: Expected output is documented for each example
5. **Use TypeScript**: Examples showcase full type safety benefits
6. **Monitor Performance**: Use analytics examples to optimize your usage

Happy coding with Robota! 🤖 