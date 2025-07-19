'use client'

import { useRef, useEffect } from 'react'
import Editor, { OnMount } from '@monaco-editor/react'
import { useTheme } from 'next-themes'
import type { editor } from 'monaco-editor'

interface CodeEditorProps {
  value: string
  onChange: (value: string | undefined) => void
  language?: string
  height?: string
  readOnly?: boolean
}

// Example templates based on real Robota SDK documentation
export const exampleTemplates = {
  basic: {
    name: 'Basic Conversation',
    description: 'Simple AI conversation using OpenAI provider',
    code: `// Basic Conversation Example
import OpenAI from 'openai'
import { Robota } from '@robota-sdk/agents'
import { OpenAIProvider } from '@robota-sdk/openai'

async function basicExample() {
    console.log('🤖 Basic Conversation Example Started...')
    
    // Create OpenAI client and provider
    const openaiClient = new OpenAI({ 
        apiKey: process.env.OPENAI_API_KEY || 'your-api-key-here'
    })
    
    const openaiProvider = new OpenAIProvider({
        client: openaiClient,
        model: 'gpt-3.5-turbo'
    })
    
    // Create Robota instance
    const robota = new Robota({
        name: 'BasicAgent',
        aiProviders: [openaiProvider],
        defaultModel: {
            provider: 'openai',
            model: 'gpt-3.5-turbo',
            systemMessage: 'You are a helpful AI assistant.'
        }
    })
    
    // Simple conversation
    const response = await robota.run('Hello! What can you tell me about AI agents?')
    console.log('Assistant:', response)
    
    // Clean up
    await robota.destroy()
}

// Run the example
basicExample().catch(console.error)`
  },

  tools: {
    name: 'Function Calling',
    description: 'AI agent with custom tools and function calling',
    code: `// Function Calling Example
import OpenAI from 'openai'
import { Robota, createFunctionTool } from '@robota-sdk/agents'
import { OpenAIProvider } from '@robota-sdk/openai'

async function toolExample() {
    console.log('🛠️ Tool Calling Example Started...')
    
    // Create a calculator tool
    const calculatorTool = createFunctionTool(
        'calculate',
        'Performs basic mathematical calculations',
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
        async (params) => {
            const { operation, a, b } = params
            console.log(\`🧮 Calculating: \${a} \${operation} \${b}\`)
            
            switch (operation) {
                case 'add': return { result: a + b }
                case 'subtract': return { result: a - b }
                case 'multiply': return { result: a * b }
                case 'divide': 
                    if (b === 0) throw new Error('Division by zero')
                    return { result: a / b }
                default: throw new Error(\`Unknown operation: \${operation}\`)
            }
        }
    )
    
    // Create weather tool
    const weatherTool = createFunctionTool(
        'getWeather',
        'Get current weather for a city',
        {
            type: 'object',
            properties: {
                city: { type: 'string', description: 'City name' },
                unit: { 
                    type: 'string', 
                    enum: ['celsius', 'fahrenheit'],
                    description: 'Temperature unit'
                }
            },
            required: ['city']
        },
        async (params) => {
            const { city, unit = 'celsius' } = params
            console.log(\`🌤️ Getting weather for \${city}\`)
            
            // Mock weather data
            const temp = unit === 'celsius' ? 22 : 72
            return {
                city,
                temperature: \`\${temp}°\${unit === 'celsius' ? 'C' : 'F'}\`,
                condition: 'Sunny',
                humidity: '65%'
            }
        }
    )
    
    // Create agent with tools
    const robota = new Robota({
        name: 'ToolAgent',
        aiProviders: [new OpenAIProvider({
            client: new OpenAI({ apiKey: process.env.OPENAI_API_KEY }),
            model: 'gpt-3.5-turbo'
        })],
        defaultModel: {
            provider: 'openai',
            model: 'gpt-3.5-turbo',
            systemMessage: 'You are a helpful assistant with access to calculation and weather tools.'
        },
        tools: [calculatorTool, weatherTool]
    })
    
    // Test tool calling
    const queries = [
        'What is 15 multiplied by 7?',
        'What\'s the weather like in Tokyo?',
        'Calculate 100 divided by 8, then tell me the weather in Seoul'
    ]
    
    for (const query of queries) {
        console.log(\`\\nUser: \${query}\`)
        const response = await robota.run(query)
        console.log(\`Assistant: \${response}\`)
    }
    
    await robota.destroy()
}

toolExample().catch(console.error)`
  },

  streaming: {
    name: 'Streaming Response',
    description: 'Real-time streaming of AI responses',
    code: `// Streaming Response Example
import OpenAI from 'openai'
import { Robota } from '@robota-sdk/agents'
import { OpenAIProvider } from '@robota-sdk/openai'

async function streamingExample() {
    console.log('🌊 Streaming Example Started...')
    
    const robota = new Robota({
        name: 'StreamingAgent',
        aiProviders: [new OpenAIProvider({
            client: new OpenAI({ apiKey: process.env.OPENAI_API_KEY }),
            model: 'gpt-3.5-turbo'
        })],
        defaultModel: {
            provider: 'openai',
            model: 'gpt-3.5-turbo',
            systemMessage: 'You are a creative storyteller.'
        }
    })
    
    console.log('Assistant: ')
    
    // Stream response chunk by chunk
    for await (const chunk of robota.runStream('Tell me a short story about robots and humans working together')) {
        process.stdout.write(chunk)
        // Simulate real-time display with small delay
        await new Promise(resolve => setTimeout(resolve, 50))
    }
    
    console.log('\\n\\n✅ Story completed!')
    
    await robota.destroy()
}

streamingExample().catch(console.error)`
  },

  multiProvider: {
    name: 'Multi-Provider',
    description: 'Using multiple AI providers in one application',
    code: `// Multi-Provider Example
import OpenAI from 'openai'
import Anthropic from '@anthropic-ai/sdk'
import { Robota } from '@robota-sdk/agents'
import { OpenAIProvider } from '@robota-sdk/openai'
import { AnthropicProvider } from '@robota-sdk/anthropic'

async function multiProviderExample() {
    console.log('🔄 Multi-Provider Example Started...')
    
    // Create multiple providers
    const openaiProvider = new OpenAIProvider({
        client: new OpenAI({ apiKey: process.env.OPENAI_API_KEY }),
        model: 'gpt-3.5-turbo'
    })
    
    const anthropicProvider = new AnthropicProvider({
        client: new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY }),
        model: 'claude-3-haiku-20240307'
    })
    
    // Create agent with multiple providers
    const robota = new Robota({
        name: 'MultiProviderAgent',
        aiProviders: [openaiProvider, anthropicProvider],
        defaultModel: {
            provider: 'openai',
            model: 'gpt-3.5-turbo',
            systemMessage: 'You are a helpful AI assistant.'
        }
    })
    
    const question = 'Explain quantum computing in simple terms'
    
    // Test with OpenAI
    console.log('\\n🤖 OpenAI Response:')
    console.log('User:', question)
    let response = await robota.run(question)
    console.log('Assistant:', response)
    
    // Switch to Anthropic
    // Note: Provider switching would require additional configuration
    // This is a conceptual example
    console.log('\\n🧠 Anthropic Response:')
    console.log('User:', question)
    // response = await robota.run(question, { provider: 'anthropic' })
    console.log('Assistant:', 'Provider switching requires additional setup')
    
    await robota.destroy()
}

multiProviderExample().catch(console.error)`
  },

  plugins: {
    name: 'Plugins & Analytics',
    description: 'Advanced features with plugins and monitoring',
    code: `// Plugins & Analytics Example
import OpenAI from 'openai'
import { 
    Robota, 
    LoggingPlugin, 
    UsagePlugin, 
    PerformancePlugin,
    createFunctionTool 
} from '@robota-sdk/agents'
import { OpenAIProvider } from '@robota-sdk/openai'

async function pluginsExample() {
    console.log('🔌 Plugins & Analytics Example Started...')
    
    // Create a simple tool for demonstration
    const timeTool = createFunctionTool(
        'getCurrentTime',
        'Get the current date and time',
        {
            type: 'object',
            properties: {
                timezone: { 
                    type: 'string', 
                    description: 'Timezone (optional)',
                    default: 'UTC'
                }
            }
        },
        async (params) => {
            const { timezone = 'UTC' } = params
            const now = new Date()
            return {
                timestamp: now.toISOString(),
                readable: now.toLocaleString('en-US', { timeZone: timezone }),
                timezone
            }
        }
    )
    
    // Create agent with comprehensive plugin setup
    const robota = new Robota({
        name: 'AnalyticsAgent',
        aiProviders: [new OpenAIProvider({
            client: new OpenAI({ apiKey: process.env.OPENAI_API_KEY }),
            model: 'gpt-3.5-turbo'
        })],
        defaultModel: {
            provider: 'openai',
            model: 'gpt-3.5-turbo',
            systemMessage: 'You are a helpful assistant with time and analytics capabilities.'
        },
        tools: [timeTool],
        plugins: [
            // Logging plugin for detailed logs
            new LoggingPlugin({
                level: 'info',
                enabled: true,
                strategy: 'console'
            }),
            
            // Usage tracking plugin
            new UsagePlugin({
                strategy: 'memory',
                trackTokens: true,
                trackCosts: true
            }),
            
            // Performance monitoring plugin
            new PerformancePlugin({
                enabled: true,
                trackLatency: true,
                trackMemory: true
            })
        ],
        logging: {
            level: 'info',
            enabled: true
        }
    })
    
    // Run several queries to generate analytics data
    const queries = [
        'Hello! How are you?',
        'What time is it?',
        'Can you tell me the current time in Tokyo?',
        'Explain what an AI agent is'
    ]
    
    for (let i = 0; i < queries.length; i++) {
        const query = queries[i]
        console.log(\`\\n\${i + 1}. User: \${query}\`)
        
        const startTime = Date.now()
        const response = await robota.run(query)
        const duration = Date.now() - startTime
        
        console.log(\`   Assistant: \${response}\`)
        console.log(\`   ⏱️ Duration: \${duration}ms\`)
    }
    
    // Show final statistics
    console.log('\\n📊 Final Analytics:')
    const stats = robota.getStats()
    console.log('- Agent Name:', stats.name)
    console.log('- Total Conversations:', stats.conversationCount || 'N/A')
    console.log('- Uptime:', \`\${Math.round(stats.uptime / 1000)}s\`)
    console.log('- Tools Available:', stats.tools?.join(', ') || 'None')
    
    await robota.destroy()
}

pluginsExample().catch(console.error)`
  }
}

const defaultCode = exampleTemplates.basic.code

export function CodeEditor({
  value,
  onChange,
  language = 'typescript',
  height = '100%',
  readOnly = false
}: CodeEditorProps) {
  const { theme } = useTheme()
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null)

  const handleEditorDidMount: OnMount = (editor, monaco) => {
    editorRef.current = editor

    // Configure TypeScript compiler options
    monaco.languages.typescript.typescriptDefaults.setCompilerOptions({
      target: monaco.languages.typescript.ScriptTarget.ES2020,
      allowNonTsExtensions: true,
      moduleResolution: monaco.languages.typescript.ModuleResolutionKind.NodeJs,
      module: monaco.languages.typescript.ModuleKind.CommonJS,
      noEmit: true,
      esModuleInterop: true,
      jsx: monaco.languages.typescript.JsxEmit.React,
      reactNamespace: 'React',
      allowJs: true,
      typeRoots: ['node_modules/@types']
    })

    // Add Robota SDK type definitions (based on real API)
    const robotaTypes = `
        declare module 'openai' {
          export default class OpenAI {
            constructor(config: { apiKey: string })
          }
        }

        declare module '@anthropic-ai/sdk' {
          export default class Anthropic {
            constructor(config: { apiKey: string })
          }
        }

        declare module '@robota-sdk/agents' {
          export interface AgentConfig {
            name: string
            aiProviders: any[]
            defaultModel: {
              provider: string
              model: string
              systemMessage?: string
            }
            tools?: any[]
            plugins?: any[]
            logging?: {
              level: string
              enabled: boolean
            }
          }

          export interface RunOptions {
            sessionId?: string
            userId?: string
            metadata?: Record<string, any>
          }

          export interface ToolSchema {
            type: 'object'
            properties: Record<string, any>
            required?: string[]
          }

          export class Robota {
            readonly name: string
            readonly version: string
            constructor(config: AgentConfig)
            run(input: string, options?: RunOptions): Promise<string>
            runStream(input: string, options?: RunOptions): AsyncGenerator<string, void, undefined>
            getStats(): any
            getHistory(): any[]
            destroy(): Promise<void>
          }

          export class LoggingPlugin {
            constructor(config: {
              level?: string
              enabled?: boolean
              strategy?: 'console' | 'file' | 'remote'
            })
          }

          export class UsagePlugin {
            constructor(config: {
              strategy?: 'memory' | 'file' | 'database'
              trackTokens?: boolean
              trackCosts?: boolean
            })
          }

          export function createFunctionTool<T>(
            name: string,
            description: string,
            schema: ToolSchema,
            handler: (params: T) => Promise<any>
          ): any
        }

        declare module '@robota-sdk/openai' {
          export class OpenAIProvider {
            constructor(config: { 
              client: any
              model?: string
              apiKey?: string
            })
            readonly name: string
          }
        }

        declare module '@robota-sdk/anthropic' {
          export class AnthropicProvider {
            constructor(config: { 
              client: any
              model?: string
              apiKey?: string
            })
            readonly name: string
          }
        }

        declare module '@robota-sdk/google' {
          export class GoogleProvider {
            constructor(config: { 
              client: any
              model?: string
              apiKey?: string
            })
            readonly name: string
          }
        }
        `

    monaco.languages.typescript.typescriptDefaults.addExtraLib(
      robotaTypes,
      'robota-types.d.ts'
    )

    // Configure editor settings
    editor.updateOptions({
      fontSize: 14,
      tabSize: 2,
      minimap: { enabled: false },
      automaticLayout: true,
      suggestOnTriggerCharacters: true,
      quickSuggestions: {
        other: true,
        comments: true,
        strings: true
      }
    })

    // Add keyboard shortcuts
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
      // Handle save
      console.log('Save triggered')
    })

    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => {
      // Handle run
      console.log('Run triggered')
    })
  }

  const handleEditorChange = (value: string | undefined) => {
    onChange(value)
  }

  return (
    <div className="w-full h-full border rounded-md overflow-hidden">
      <Editor
        height={height}
        defaultLanguage={language}
        value={value || defaultCode}
        onChange={handleEditorChange}
        theme={theme === 'dark' ? 'vs-dark' : 'light'}
        onMount={handleEditorDidMount}
        options={{
          readOnly,
          fontFamily: '"Geist Mono", "SF Mono", Monaco, Inconsolata, "Roboto Mono", Consolas, "Courier New", monospace',
          fontSize: 14,
          lineHeight: 20,
          padding: { top: 16, bottom: 16 },
          selectOnLineNumbers: true,
          roundedSelection: false,
          cursorStyle: 'line',
          automaticLayout: true,
          minimap: { enabled: false },
          wordWrap: 'on',
          lineNumbers: 'on',
          rulers: [80, 120],
          renderLineHighlight: 'line',
          renderWhitespace: 'boundary',
          cursorBlinking: 'blink',
          cursorSmoothCaretAnimation: 'on',
          contextmenu: true,
          mouseWheelZoom: true,
          quickSuggestions: {
            other: true,
            comments: true,
            strings: true
          },
          suggestOnTriggerCharacters: true,
          acceptSuggestionOnEnter: 'on',
          tabCompletion: 'on',
          snippetSuggestions: 'top',
          parameterHints: {
            enabled: true
          },
          hover: {
            enabled: true
          }
        }}
      />
    </div>
  )
} 