# Browser Usage Examples

Learn how to use Robota SDK in browser environments including vanilla JavaScript, React, Vue, and more.

## 🌐 Cross-Platform Compatibility

Robota SDK works seamlessly across **all JavaScript environments** with **zero breaking changes**:

- ✅ **Node.js**: Full feature support (existing users unaffected)
- ✅ **Browsers**: Complete compatibility with memory storage
- ✅ **WebWorkers**: Background AI processing support
- ✅ **React/Vue/Svelte**: Modern framework integration
- ✅ **Next.js/Nuxt**: SSR and client-side support

## 🚀 Quick Browser Setup

### Installation

```bash
# Same packages work everywhere!
npm install @robota-sdk/agents @robota-sdk/openai openai
```

### Environment Variables

**Next.js/React**:
```env
NEXT_PUBLIC_OPENAI_API_KEY=your_api_key
```

**Vite/Vue**:
```env
VITE_OPENAI_API_KEY=your_api_key
```

## 📋 Basic Browser Configuration

### Browser-Optimized Setup

```typescript
import { Robota, LoggingPlugin, UsagePlugin, ConversationHistoryPlugin } from '@robota-sdk/agents';
import { OpenAIProvider } from '@robota-sdk/openai';

// Browser-compatible configuration
const agent = new Robota({
    name: 'BrowserAgent',
    aiProviders: [
        new OpenAIProvider({
            apiKey: process.env.NEXT_PUBLIC_OPENAI_API_KEY!
        })
    ],
    defaultModel: {
        provider: 'openai',
        model: 'gpt-3.5-turbo'
    },
    plugins: [
        // Use console logging (no file system)
        new LoggingPlugin({ 
            strategy: 'console',
            level: 'info'
        }),
        
        // Use memory storage (no file system)
        new UsagePlugin({ 
            strategy: 'memory' 
        }),
        
        // Memory-based conversation history
        new ConversationHistoryPlugin({ 
            storage: { strategy: 'memory' },
            maxMessages: 100
        })
    ]
});
```

## 🔒 Security Best Practices

### Option 1: Proxy Server (Recommended)

Create API proxy endpoints to keep keys secure:

```typescript
// Frontend code (no API keys exposed)
const agent = new Robota({
    name: 'SecureAgent',
    aiProviders: [
        new OpenAIProvider({
            baseURL: '/api/openai',  // Your proxy endpoint
            apiKey: 'dummy'          // Not used
        })
    ],
    defaultModel: {
        provider: 'openai',
        model: 'gpt-3.5-turbo'
    }
});
```

**Next.js API Route** (`pages/api/openai/chat.ts`):
```typescript
import { NextApiRequest, NextApiResponse } from 'next';
import OpenAI from 'openai';

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY // Secure server-side
});

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
    if (req.method !== 'POST') {
        return res.status(405).json({ message: 'Method not allowed' });
    }

    try {
        const response = await openai.chat.completions.create(req.body);
        res.status(200).json(response);
    } catch (error) {
        res.status(500).json({ error: 'API call failed' });
    }
}
```

### Option 2: Public API Keys (Development Only)

```typescript
// ⚠️ Only for development/demos
const agent = new Robota({
    name: 'DevAgent',
    aiProviders: [
        new OpenAIProvider({
            apiKey: process.env.NEXT_PUBLIC_OPENAI_API_KEY! // Exposed in browser
        })
    ]
});
```

## 🎯 Framework-Specific Examples

### React Hook

```typescript
// hooks/useRobotaAgent.ts
import { useState, useEffect } from 'react';
import { Robota, LoggingPlugin } from '@robota-sdk/agents';
import { OpenAIProvider } from '@robota-sdk/openai';

export function useRobotaAgent() {
    const [agent, setAgent] = useState<Robota | null>(null);
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        const robotaAgent = new Robota({
            name: 'ReactAgent',
            aiProviders: [
                new OpenAIProvider({
                    apiKey: process.env.NEXT_PUBLIC_OPENAI_API_KEY!
                })
            ],
            defaultModel: {
                provider: 'openai',
                model: 'gpt-3.5-turbo'
            },
            plugins: [
                new LoggingPlugin({ strategy: 'console' })
            ]
        });

        setAgent(robotaAgent);

        // Cleanup on unmount
        return () => {
            robotaAgent.destroy();
        };
    }, []);

    const chat = async (message: string) => {
        if (!agent) return '';
        
        setLoading(true);
        try {
            const response = await agent.run(message);
            return response;
        } finally {
            setLoading(false);
        }
    };

    const chatStream = async function* (message: string) {
        if (!agent) return;
        
        setLoading(true);
        try {
            const stream = await agent.runStream(message);
            for await (const chunk of stream) {
                yield chunk;
            }
        } finally {
            setLoading(false);
        }
    };

    return { agent, chat, chatStream, loading };
}
```

**React Component**:
```typescript
// components/ChatInterface.tsx
import React, { useState } from 'react';
import { useRobotaAgent } from '../hooks/useRobotaAgent';

export function ChatInterface() {
    const [message, setMessage] = useState('');
    const [response, setResponse] = useState('');
    const { chat, loading } = useRobotaAgent();

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!message.trim()) return;

        const result = await chat(message);
        setResponse(result);
        setMessage('');
    };

    return (
        <div className="chat-interface">
            <form onSubmit={handleSubmit}>
                <input
                    type="text"
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    placeholder="Ask me anything..."
                    disabled={loading}
                />
                <button type="submit" disabled={loading}>
                    {loading ? 'Thinking...' : 'Send'}
                </button>
            </form>
            
            {response && (
                <div className="response">
                    <strong>AI:</strong> {response}
                </div>
            )}
        </div>
    );
}
```

### Vue Composition API

```typescript
// composables/useRobotaAgent.ts
import { ref, onUnmounted } from 'vue';
import { Robota, LoggingPlugin } from '@robota-sdk/agents';
import { OpenAIProvider } from '@robota-sdk/openai';

export function useRobotaAgent() {
    const agent = ref<Robota | null>(null);
    const loading = ref(false);

    // Initialize agent
    const initAgent = () => {
        agent.value = new Robota({
            name: 'VueAgent',
            aiProviders: [
                new OpenAIProvider({
                    apiKey: import.meta.env.VITE_OPENAI_API_KEY
                })
            ],
            defaultModel: {
                provider: 'openai',
                model: 'gpt-3.5-turbo'
            },
            plugins: [
                new LoggingPlugin({ strategy: 'console' })
            ]
        });
    };

    const chat = async (message: string) => {
        if (!agent.value) return '';
        
        loading.value = true;
        try {
            return await agent.value.run(message);
        } finally {
            loading.value = false;
        }
    };

    // Cleanup
    onUnmounted(() => {
        agent.value?.destroy();
    });

    initAgent();

    return {
        agent: readonly(agent),
        loading: readonly(loading),
        chat
    };
}
```

### Vanilla JavaScript

```html
<!DOCTYPE html>
<html>
<head>
    <title>Robota Browser Demo</title>
    <script type="module">
        import { Robota, LoggingPlugin } from 'https://cdn.skypack.dev/@robota-sdk/agents';
        import { OpenAIProvider } from 'https://cdn.skypack.dev/@robota-sdk/openai';

        // Initialize Robota agent
        const agent = new Robota({
            name: 'BrowserDemo',
            aiProviders: [
                new OpenAIProvider({
                    apiKey: 'your-api-key' // In production, use proxy
                })
            ],
            defaultModel: {
                provider: 'openai',
                model: 'gpt-3.5-turbo'
            },
            plugins: [
                new LoggingPlugin({ strategy: 'console' })
            ]
        });

        // Chat function
        window.chat = async (message) => {
            const response = await agent.run(message);
            document.getElementById('response').textContent = response;
        };

        // Streaming chat
        window.chatStream = async (message) => {
            const responseEl = document.getElementById('response');
            responseEl.textContent = '';
            
            const stream = await agent.runStream(message);
            for await (const chunk of stream) {
                responseEl.textContent += chunk;
            }
        };
    </script>
</head>
<body>
    <h1>Robota Browser Demo</h1>
    
    <input type="text" id="message" placeholder="Ask me anything..." />
    <button onclick="chat(document.getElementById('message').value)">
        Send
    </button>
    <button onclick="chatStream(document.getElementById('message').value)">
        Stream
    </button>
    
    <div id="response"></div>
</body>
</html>
```

## 🔧 WebWorker Usage

Process AI requests in background threads:

```typescript
// worker.ts
import { Robota, LoggingPlugin } from '@robota-sdk/agents';
import { OpenAIProvider } from '@robota-sdk/openai';

const agent = new Robota({
    name: 'WorkerAgent',
    aiProviders: [
        new OpenAIProvider({
            apiKey: 'your-api-key'
        })
    ],
    defaultModel: {
        provider: 'openai',
        model: 'gpt-3.5-turbo'
    },
    plugins: [
        new LoggingPlugin({ strategy: 'console' })
    ]
});

self.onmessage = async (event) => {
    const { type, message, id } = event.data;
    
    if (type === 'chat') {
        try {
            const response = await agent.run(message);
            self.postMessage({ type: 'response', response, id });
        } catch (error) {
            self.postMessage({ type: 'error', error: error.message, id });
        }
    }
};
```

**Main Thread**:
```typescript
// main.ts
const worker = new Worker('/worker.js');
let messageId = 0;

function chatWithWorker(message: string): Promise<string> {
    return new Promise((resolve, reject) => {
        const id = ++messageId;
        
        const handleMessage = (event: MessageEvent) => {
            if (event.data.id === id) {
                worker.removeEventListener('message', handleMessage);
                
                if (event.data.type === 'response') {
                    resolve(event.data.response);
                } else if (event.data.type === 'error') {
                    reject(new Error(event.data.error));
                }
            }
        };
        
        worker.addEventListener('message', handleMessage);
        worker.postMessage({ type: 'chat', message, id });
    });
}

// Usage
chatWithWorker('Hello!').then(response => {
    console.log('AI Response:', response);
});
```

## 🎛️ Browser-Specific Configuration

### Storage Options

```typescript
import { 
    Robota, 
    ConversationHistoryPlugin,
    UsagePlugin,
    LoggingPlugin 
} from '@robota-sdk/agents';

// Memory storage (recommended for browsers)
const agent = new Robota({
    name: 'BrowserAgent',
    plugins: [
        // Console logging only
        new LoggingPlugin({ 
            strategy: 'console' 
        }),
        
        // Memory-based usage tracking
        new UsagePlugin({ 
            strategy: 'memory',
            aggregationInterval: 60000 // 1 minute
        }),
        
        // Memory-based conversation history
        new ConversationHistoryPlugin({
            storage: { 
                strategy: 'memory',
                maxSize: 1000 // Limit memory usage
            },
            autoSave: true,
            batchSize: 10
        })
    ]
});
```

### Performance Optimization

```typescript
// Optimized browser configuration
const agent = new Robota({
    name: 'OptimizedBrowserAgent',
    aiProviders: [openaiProvider],
    defaultModel: {
        provider: 'openai',
        model: 'gpt-3.5-turbo' // Faster model for browser
    },
    plugins: [
        new LoggingPlugin({ 
            strategy: 'console',
            level: 'warn' // Reduce console noise
        }),
        
        new UsagePlugin({ 
            strategy: 'memory',
            aggregationInterval: 300000 // 5 minutes (less frequent)
        })
    ]
});
```

## 🌟 Browser Compatibility Features

### What Works Everywhere

✅ **Core AI Conversations**: Full compatibility across all environments
✅ **Tool Execution**: Function tools with Zod validation
✅ **Streaming Responses**: Real-time streaming via Fetch API
✅ **Plugin System**: All plugins work in browsers
✅ **Memory Storage**: In-memory data structures
✅ **WebHook Signatures**: Pure JavaScript crypto implementation (jsSHA)

### Browser Limitations

❌ **File Storage**: Use memory storage instead
⚠️ **System Metrics**: Limited browser metrics available
⚠️ **API Keys**: Use proxy servers for production

### Migration from Node.js

**Zero Breaking Changes**: Existing Node.js code works unchanged:

```typescript
// This exact same code works in both Node.js and browsers!
const agent = new Robota({
    name: 'UniversalAgent',
    aiProviders: [openaiProvider],
    defaultModel: {
        provider: 'openai',
        model: 'gpt-3.5-turbo'
    }
});

const response = await agent.run('Hello!');
```

Only difference: Replace file storage with memory storage in browser environments.

## 🎯 Next Steps

1. **Start Simple**: Begin with basic chat functionality
2. **Add Security**: Implement proxy servers for production
3. **Optimize Storage**: Use appropriate storage strategies
4. **Monitor Performance**: Track usage and optimize
5. **Scale Up**: Add more providers and advanced features

The Robota SDK's cross-platform design means you can start in any environment and seamlessly move between Node.js, browsers, and WebWorkers as your needs evolve! 🚀 