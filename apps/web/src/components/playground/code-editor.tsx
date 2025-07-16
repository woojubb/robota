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

const defaultCode = `// Welcome to Robota Playground
import { Agent } from '@robota/agents'
import { OpenAIProvider } from '@robota/openai'

// Create a new agent with OpenAI provider
const agent = new Agent({
  provider: new OpenAIProvider({
    apiKey: process.env.OPENAI_API_KEY,
    model: 'gpt-4'
  })
})

// Add a simple tool
agent.addTool({
  name: 'getCurrentTime',
  description: 'Get the current time',
  execute: async () => {
    return new Date().toLocaleString()
  }
})

// Define the agent's system message
agent.setSystemMessage(\`
You are a helpful AI assistant. You can:
- Answer questions
- Help with coding tasks
- Get the current time when needed

Always be helpful and professional.
\`)

// Export the agent for use
export default agent

// Example usage:
// const response = await agent.run('What time is it?')
// console.log(response)
`

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

        // Add Robota SDK type definitions (mock)
        const robotaTypes = `
        declare module '@robota/agents' {
          export class Agent {
            constructor(config: { provider: any })
            addTool(tool: { name: string; description: string; execute: () => any }): void
            setSystemMessage(message: string): void
            run(input: string): Promise<string>
          }
        }

        declare module '@robota/openai' {
          export class OpenAIProvider {
            constructor(config: { apiKey: string; model?: string })
          }
        }

        declare module '@robota/anthropic' {
          export class AnthropicProvider {
            constructor(config: { apiKey: string; model?: string })
          }
        }

        declare module '@robota/google' {
          export class GoogleProvider {
            constructor(config: { apiKey: string; model?: string })
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
            scrollBeyondLastLine: false,
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
                    scrollBeyondLastLine: false,
                    minimap: { enabled: false },
                    wordWrap: 'on',
                    lineNumbers: 'on',
                    rulers: [80, 120],
                    renderLineHighlight: 'line',
                    renderWhitespace: 'boundary',
                    smoothScrolling: true,
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